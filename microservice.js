/*jslint node:true, regexp: true, unparam: true */
(function () {

    "use strict";
    var polo = require("polo")({"heartbeat": 5 * 1000}),
        util = require("./microservice.util"),
        semver = require("semver"),
        dnode = require("dnode"),
        start_port = 10000, // Default starting port number to use
        stop_port = 15000, // Default ending port number to use
        zapper_time = 5 * 1000; // Timeout used by facades for disconnecting idle client connections
    // Alias removeListener because that's just plain annoying
    polo.off = polo.removeListener;
    // Determine the IPv4 address to use if a host isn't provided for service creation
    function getHostAddress() {
        var i, candidate, nets = require('os').networkInterfaces();
        function filterFunc(item) {
            return item.family === 'IPv4' && !item.internal;
        }
        for (i in nets) {
            if (nets.hasOwnProperty(i)) {
                candidate = nets[i].filter(filterFunc)[0];
                if (candidate) {
                    return candidate.address;
                }
            }
        }
        return "127.0.0.1";
    }
    // Take a service full name and break it into version and name
    function getServiceDetails(full_name) {
        var name = full_name, version = "0.0.0";
        if (typeof full_name === "string" && full_name.match(/^.*@\d+(\.\d+){0,2}$/)) {
            name = full_name.replace(/^(.*)@\d+(\.\d+){0,2}$/, "$1");
            version = full_name.replace(/^.*@(\d+(\.\d+){0,2})$/, "$1");
        }
        return {"name": name, "version": version};
    }
    // Bind inner prototype functions to inner and provide aliases on outer
    function bindFuncs(inner, outer, funcs) {
        var proto = inner.constructor.prototype;
        funcs.forEach(function (f) {
            if (proto.hasOwnProperty(f)) {
                if (typeof proto[f] === "function") {
                    outer[f] = proto[f].bind(inner);
                }
            }
        });
    }
    // Given a port or array pair of port ranges get a randomized port to use
    function getPortFromRange(range) {
        var stride;
        if (util.isIntegerPositive(range)) {
            return util.asIntegerPositive(range);
        }
        if (util.isArray(range) && util.isIntegerPositive(range[0]) && util.isIntegerPositive(range[1])) {
            range = range.slice(0, 2).map(function (v) { return util.asIntegerPositive(v); }).sort();
            stride = util.asIntegerPositive(range[1] - range[0]) || 1;
            return range[0] + Math.round(Math.random() * (stride - 1));
        }
        return getPortFromRange([start_port, stop_port]);
    }
    function getError(e) {
        if (e && e.code === "ECONNREFUSED") {
            return util.error["504"];
        }
        return e;
    }
    ////////////////////
    // Service class  //
    ////////////////////
    function Service(outer, name, version, host, port) {
        if (!(this instanceof Service)) {
            return new Service(outer, name, version, host, port);
        }
        var self = this;
        self.outer = outer;
        self.name = util.asString(name, "micro-service");
        self.version = semver.valid(version) ? version : "0.0.0";
        self.host = util.asString(host, getHostAddress());
        self.port = getPortFromRange(port);
        self.full_name = self.name + "@" + self.version;
        self.service_address = self.full_name + "/" + self.host + ":" + self.port;
        self.running = false;
        self.service = null;
        self.neighbors = [];
        bindFuncs(self, self.outer, ["get", "toJSON", "start", "stop"]);
        bindFuncs(self, self, ["onUp", "onDown", "onDone", "onEmit"]);
        util.makeEventEmitter(self.outer);
    }
    Service.prototype.onUp = function onUpF(name, service) {
        var self = this;
        if (name === self.full_name
                && service.host === self.host
                && service.port !== self.port
                && self.neighbors.indexOf(service.port) < 0) {
            self.neighbors.push(service.port);
        }
    };
    Service.prototype.onDown = function onDownF(name, service) {
        var self = this;
        if (name === self.full_name && self.neighbors.indexOf(service.port) > -1) {
            self.neighbors.splice(self.neighbors.indexOf(service.port), 1);
        }
    };
    Service.prototype.onDone = function onDoneF() {
        var self = this;
        if (self.service || !self.dnode || self.running) { return; }
        polo.off("up", self.onUp);
        polo.off("down", self.onDown);
        polo.emit("pop", self.service);
        self.service = null;
        self.dnode = null;
    };
    Service.prototype.onEmit = function onEmitF() {
        var self = this,
            args = Array.prototype.slice.apply(arguments),
            cb = util.asFunction(args[args.length - 1]);
        if (!util.isString(args[0])) {
            cb(new Error("Invalid message"));
        }
        self.outer.emit.apply(self.outer, args);
    };
    Service.prototype.get = function get(prop) {
        if (this[prop] && !util.isFunction(this[prop]) && prop !== "outer") {
            return this[prop];
        }
    };
    Service.prototype.toJSON = function toJSONF() {
        return {
            "name": this.name,
            "version": this.version,
            "full_name": this.full_name,
            "host": this.host,
            "port": this.port
        };
    };
    Service.prototype.start = function startF(cb) {
        var self = this;
        if (self.running) { return self; }
        self.running = true;
        self.dnode = dnode({"emit": self.onEmit});
        self.dnode.on("error", function (e) { self.outer.emit("error", getError(e)); });
        self.dnode.on("fail", function () { self.outer.emit("error", util.error["500"]); });
        self.dnode.listen(self.port, function () {
            self.dnode.on("end", function () { self.outer.emit("error", util.error["500"]); });
            polo.on("up", self.onUp);
            polo.on("down", self.onDown);
            self.service = polo.put({"name": self.full_name, "host": self.host, "port": self.port});
            if (util.isFunction(cb)) { cb(); }
        });
        return self;
    };
    Service.prototype.stop = function stopF() {
        var self = this;
        if (self.running) {
            self.running = false;
            if (self.dnode) {
                self.dnode.once("end", self.onDone);
                self.dnode.end();
                setTimeout(self.onDone, 500); // Fallback to ensure it gets closed
            }
        }
        return self;
    };

    ///////////////////
    // Client class  //
    ///////////////////
    function Client(service) {
        var self = this,
            d,
            remote,
            send_stack = [];
        function clearStack(e) {
            e = getError(e);
            if (send_stack.length > 0) {
                send_stack.forEach(function (stack) {
                    var cb = stack[stack.length - 1];
                    cb(e);
                });
            }
            self.emit("error", e);
        }
        try {
            d = dnode.connect({"host": service.host, "port": service.port});
            d.on("remote", function onRemote(r) {
                remote = r;
                self.emit("remote");
            });
            d.on("error", function (e) {
                clearStack(getError(e));
            });
            d.on("fail", function () {
                clearStack(util.error["500"]);
            });
            d.on("end", function () {
                clearStack(util.error["504"]);
            });
        } catch (ignore) {}
        self.send = function otherMessage() {
            var args = Array.prototype.slice.apply(arguments),
                cb = util.asFunction(args[args.length - 1]);
            if (args[args.length - 1] !== cb) {
                args.push(cb);
            }
            args[args.length - 1] = function cb2() {
                send_stack.splice(send_stack.indexOf(args), 1);
                cb.apply(cb, arguments);
            };
            if (!util.isString(args[0])) {
                return cb(new Error("Invalid message"));
            }
            if (d && remote) {
                send_stack.push(args);
                remote.emit.apply(remote, args);
            } else {
                cb(new Error("Pending connection."));
            }
        };
        self.end = function otherEnd(cb) {
            cb = util.asFunction(cb);
            try {
                d.end(function () {
                    d = null;
                    remote = null;
                    cb();
                });
            } catch (e) {
                cb(getError(e));
            }
            return self;
        };
        self.service_address = service.name + "/" + service.host + ":" + service.port;
        util.makeEventEmitter(self);
    }


    /////////////////////////
    // MicroService class  //
    /////////////////////////
    function MicroService(name, version, host, port) {
        if (!(this instanceof MicroService)) {
            return new MicroService(name, version, host, port);
        }
        return new Service(this, name, version, host, port).outer;
    }

    function getClient(ignore, name, range, cb) {
        cb = util.asFunction(cb);
        var candidates = [],
            list,
            k,
            selection,
            details,
            client;
        ignore = util.isArray(ignore) ? ignore : [];
        ignore.filter(function (service) { return service instanceof MicroService; });
        function fail(e) {
            cb(getError(e) || util.error["503"]);
        }
        function candidateFilter(service) {
            return ignore.filter(function (micro) {
                return micro && service.host === micro.get("host") && service.port === micro.get("port");
            }).length === 0;
        }
        list = polo.all();
        for (k in list) {
            if (list.hasOwnProperty(k)) {
                details = getServiceDetails(k);
                if (details.name === name && semver.satisfies(details.version, range)) {
                    candidates = candidates.concat(list[k].filter(candidateFilter));
                }
            }
        }
        if (candidates.length > 0) {
            selection = candidates[Math.floor(Math.random() * candidates.length)];
            client = new Client(selection);
            client.on("error", fail);
            client.once("remote", function () {
                client.off("error", fail);
                cb(null, client);
            });
        } else {
            fail();
        }
    }

    function getService() {
        var args = Array.prototype.slice.apply(arguments),
            cb = util.asFunction(args.pop()),
            fail,
            service;
        service = new MicroService(args[0], args[1], args[2], args[3]);
        fail = function failF(e) {
            service.off("error", fail);
            cb(getError(e) || util.error["500"]);
        };
        service.on("error", fail);
        service.start(function upF() {
            service.off("error", fail);
            cb(null, service);
        });
    }

    function ClientFacade(ignore, name, range) {
        this.ignore = ignore;
        this.name = name;
        this.range = range;
        this.client = null;
        this.zapper = null;
        this.requests = 0;
        this.reset = false;
        this.forceZapIt = ClientFacade.prototype.forceZapIt.bind(this);
        this.zapIt = ClientFacade.prototype.zapIt.bind(this);
    }
    ClientFacade.prototype.resetZapper = function resetZapperF() {
        var self = this;
        clearTimeout(self.zapper);
        if (self.reset) {
            self.reset = false;
            return self.zapIt();
        }
        self.zapper = setTimeout(self.zapIt, zapper_time);
    };
    ClientFacade.prototype.forceZapIt = function forceZapItF(e) {
        var self = this;
        self.requests = 0;
        self.zapIt(getError(e));
    };
    ClientFacade.prototype.zapIt = function zapItF(e, cb) {
        var self = this;
        cb = util.asFunction(cb);
        if (self.client && self.requests > 0) {
            return self.resetZapper();
        }
        if (self.client && self.requests < 1) {
            self.client.off("error", self.forceZapIt);
            self.client.on("end", self.forceZapIt);
            self.client.end(cb);
        }
        self.client = null;
        clearTimeout(self.zapper);
    };
    ClientFacade.prototype.getClient = function getClientF(cb) {
        var self = this;
        getClient(self.ignore, self.name, self.range, function (e, c) {
            if (c) {
                self.client = c;
                self.client.on("error", self.forceZapIt);
                self.client.on("end", self.forceZapIt);
                self.resetZapper();
            } else {
                e = getError(e) || util.error["503"];
            }
            cb(e, self);
        });
    };
    ClientFacade.prototype.send = function sendF() {
        var self = this,
            args = Array.prototype.slice.apply(arguments),
            cb = util.asFunction(args.pop());
        if (args[args.length - 1] !== cb) {
            args.push(cb);
        }
        args[args.length - 1] = function cb2() {
            self.requests -= 1;
            self.resetZapper();
            cb.apply(cb, arguments);
        };
        if (self.client) {
            self.requests += 1;
            self.resetZapper();
            self.client.send.apply(self.client, args);
        } else {
            self.getClient(function (e) {
                if (e) {
                    return args[args.length - 1](getError(e));
                }
                self.requests += 1;
                self.client.send.apply(self.client, args);
            });
        }
    };
    ClientFacade.prototype.end = function endF(cb) {
        var self = this;
        cb = util.asFunction(cb);
        if (self.client && self.requests < 1) {
            return self.zapIt(null, cb);
        }
        cb();
    };
    ClientFacade.prototype.addIgnore = function addIgnore(service) {
        var self = this;
        if (service instanceof MicroService && self.ignore.indexOf(service) === -1) {
            self.reset = true;
            self.ignore.push(service);
            self.resetZapper();
        }
    };
    ClientFacade.prototype.removeIgnore = function addIgnore(service) {
        var self = this;
        if (service instanceof MicroService && self.ignore.indexOf(service) > -1) {
            self.reset = true;
            self.ignore.splice(self.ignore.indexOf(service), 1);
            self.resetZapper();
        }
    };
    ClientFacade.prototype.getFacade = function getFacadeF() {
        var self = this, facade = {};
        bindFuncs(self, facade, ["send", "end", "addIgnore"]);
        return facade;
    };

    function getFacade(ignore, name, range) {
        return new ClientFacade(ignore, name, range).getFacade();
    }

    module.exports = {
        "service": getService,
        "client": getFacade,
        "util": util
    };

}());