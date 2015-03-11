/*jslint node:true, regexp: true, unparam: true */
(function () {

    "use strict";
    var polo = require("polo")({"heartbeat": 5 * 1000}),
        util = require("./microservice.util"),
        semver = require("semver"),
        dnode = require("dnode"),
        ecc = require("eccjs"),
        Service,
        MicroService,
        Client,
        MicroServiceClient,
        IDLE_TIME = 5 * 1000; // Timeout used by facades for disconnecting idle client connections
    // Alias removeListener because that's just plain annoying
    polo.off = polo.removeListener;

    //////////////////////////////////////////////////////////
    // Utility functions not included in microservice.util  //
    //////////////////////////////////////////////////////////
    function getError(e) {
        if (e && e.code === "ECONNREFUSED") { return util.error["504"]; }
        return e;
    }

    /////////////////////////
    // Accessor functions  //
    /////////////////////////
    function getClient(ignore, name, range, host, port, cb) {
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
            return util.portInRange(service.port, port) &&
                (!host || service.host === host) &&
                ignore.filter(function (micro) {
                    return micro && service.host === micro.get("host") && service.port === micro.get("port");
                }).length === 0;
        }
        list = polo.all();
        for (k in list) {
            if (list.hasOwnProperty(k)) {
                details = util.getServiceDetails(k);
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
        var args = util.getArgsArray(arguments),
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
    function getMicroServiceClient(ignore, name, host, range) {
        return new MicroServiceClient(ignore, name, host, range).getMicroServiceClient();
    }
    /////////////////////////////
    // Service class (hidden)  //
    /////////////////////////////
    Service = function Service(outer, name, version, host, port) {
        if (!(this instanceof Service)) {
            return new Service(outer, name, version, host, port);
        }
        var self = this;
        self.outer = outer;
        self.name = util.asString(name, "micro-service");
        self.version = semver.valid(version) ? version : "0.0.0";
        self.host = util.asString(host, util.getHostAddress());
        self.port = util.getPortFromRange(port);
        self.full_name = self.name + "@" + self.version;
        self.service_address = self.full_name + "/" + self.host + ":" + self.port;
        self.running = false;
        self.service = null;
        self.neighbors = [];
        util.bindFuncs(self, self.outer, ["get", "toJSON", "start", "stop"]);
        util.bindFuncs(self, self, ["onUp", "onDown", "onDone", "onEmit", "onSecureEmit"]);
        util.makeEventEmitter(self.outer);
    };
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
            args = util.getArgsArray(arguments),
            cb = util.asFunction(args[args.length - 1]);
        if (!util.isString(args[0]) || args[0].match(/^(remote|end|error|fail)$/)) {
            return cb(new Error("Invalid message"));
        }
        self.outer.emit.apply(self.outer, args);
    };
    Service.prototype.onSecureEmit = function onSecureEmitF(ckey, cbC1) {
        var self = this, skey, cipherS1, cipherS2;
        cbC1 = util.asFunction(cbC1);
        if (!util.isString(ckey)) {
            return cbC1(new Error("Invalid key"));
        }
        skey = ecc.generate(ecc.ENC_DEC, 384);
        cipherS1 = ecc.encrypt(ckey, skey.enc);
        cbC1(null, cipherS1, function (e, cipherC1, cbC2) {
            if (e) { return; }
            cbC2 = util.asFunction(cbC2);
            try {
                var args = JSON.parse(ecc.decrypt(skey.dec, cipherC1));
                args.push(function () {
                    var ret = util.getArgsArray(arguments);
                    try {
                        cipherS2 = ecc.encrypt(ckey, JSON.stringify(ret));
                        cbC2(null, cipherS2);
                    } catch (ee) {
                        cbC2(ee);
                    }
                });
                self.outer.emit.apply(self.outer, args);
            } catch (ed) {
                cbC2(ed);
            }
        });
    };
    Service.prototype.get = function get(prop) {
        if (["name", "version", "host", "port", "ful_name", "service_address", "running"].indexOf(prop) > -1) {
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
        cb = util.asFunction(cb);
        if (self.running) { return self; }
        self.running = true;
        self.dnode = dnode({
            "emit": self.onEmit,
            "secureEmit": self.onSecureEmit
        });
        self.dnode.on("error", function (e) { self.outer.emit("error", getError(e)); });
        self.dnode.on("fail", function () { self.outer.emit("error", util.error["500"]); });
        self.dnode.listen(self.port, function () {
            self.dnode.on("end", function () { self.outer.emit("error", util.error["500"]); });
            polo.on("up", self.onUp);
            polo.on("down", self.onDown);
            self.service = polo.put({"name": self.full_name, "host": self.host, "port": self.port});
            cb(null, self.outer);
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
    ///////////////////////////////////
    // MicroService class (exposed)  //
    ///////////////////////////////////
    MicroService = function MicroService(name, version, host, port) {
        if (!(this instanceof MicroService)) {
            return new MicroService(name, version, host, port);
        }
        return new Service(this, name, version, host, port).outer;
    };
    ////////////////////////////
    // Client class (hidden)  //
    ////////////////////////////
    Client = function Client(service) {
        var self = this,
            d,
            remote,
            send_stack = [];
        function clearStack(e) {
            e = getError(e);
            if (send_stack.length > 0) {
                send_stack.forEach(function (stack) { stack[stack.length - 1](e); });
            }
            self.emit("error", e);
        }
        try {
            d = dnode.connect({"host": service.host, "port": service.port});
            d.on("remote", function onRemote(r) {
                remote = r;
                self.emit("remote");
            });
            d.on("error", function (e) { clearStack(getError(e)); });
            d.on("fail", function () { clearStack(util.error["500"]); });
            d.on("end", function () { clearStack(util.error["504"]); });
        } catch (ignore) {}
        self.send = function otherMessage() {
            var args = util.getArgsArray(arguments),
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
        self.secureSend = function secureSend() {
            var args = util.getArgsArray(arguments),
                cb,
                ckey,
                skey,
                cipherC1;
            if (util.isFunction(args[args.length - 1])) {
                cb = args.pop();
            }
            cb = util.asFunction(cb);
            if (args.filter(function (a) { return util.isFunction(a); }).length > 0) {
                cb(new Error("Cannot secureSend functions"));
            }
            if (!util.isString(args[0])) {
                return cb(new Error("Invalid message"));
            }
            function done() {
                send_stack.splice(send_stack.indexOf(args), 1);
                cb.apply(cb, arguments);
            }
            if (d && remote) {
                ckey = ecc.generate(ecc.ENC_DEC, 384);
                send_stack.push(args);
                remote.secureEmit(ckey.enc, function (e, cipherS1, cbS1) {
                    if (e) { return done(e); }
                    cbS1 = util.asFunction(cbS1);
                    try {
                        skey = ecc.decrypt(ckey.dec, cipherS1);
                        cipherC1 = ecc.encrypt(skey, JSON.stringify(args));
                        cbS1(null, cipherC1, function (e2, cipherS2) {
                            if (e2) { return done(e2); }
                            try {
                                var ret = JSON.parse(ecc.decrypt(ckey.dec, cipherS2));
                                done.apply(done, ret);
                            } catch (ed2) {
                                done(ed2);
                            }
                        });
                    } catch (ed) {
                        cbS1(ed);
                        done(ed);
                    }
                });
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
    };
    /////////////////////////////////////////
    // MicroServiceClient class (exposed)  //
    /////////////////////////////////////////
    MicroServiceClient = function MicroServiceClient(ignore, name, range, host, port) {
        this.ignore = ignore;
        this.name = name;
        this.range = range;
        this.host = host;
        this.port = port;
        this.client = null;
        this.zapper = null;
        this.requests = 0;
        this.reset = false;
        this.forceZapIt = MicroServiceClient.prototype.forceZapIt.bind(this);
        this.zapIt = MicroServiceClient.prototype.zapIt.bind(this);
    };
    MicroServiceClient.prototype.resetZapper = function resetZapperF() {
        var self = this;
        clearTimeout(self.zapper);
        if (self.reset) {
            self.reset = false;
            return self.zapIt();
        }
        self.zapper = setTimeout(self.zapIt, IDLE_TIME);
    };
    MicroServiceClient.prototype.forceZapIt = function forceZapItF(e) {
        var self = this;
        self.requests = 0;
        self.zapIt(getError(e));
    };
    MicroServiceClient.prototype.zapIt = function zapItF(e, cb) {
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
    MicroServiceClient.prototype.getClient = function getClientF(cb) {
        var self = this;
        getClient(self.ignore, self.name, self.range, self.host, self.port, function (e, c) {
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
    MicroServiceClient.prototype.send = function sendF() {
        var self = this,
            args = util.getArgsArray(arguments),
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
    MicroServiceClient.prototype.secureSend = function secureSendF() {
        var self = this,
            args = util.getArgsArray(arguments),
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
            self.client.secureSend.apply(self.client, args);
        } else {
            self.getClient(function (e) {
                if (e) {
                    return args[args.length - 1](getError(e));
                }
                self.requests += 1;
                self.client.secureSend.apply(self.client, args);
            });
        }
    };
    MicroServiceClient.prototype.end = function endF(cb) {
        var self = this;
        cb = util.asFunction(cb);
        if (self.client && self.requests < 1) {
            return self.zapIt(null, cb);
        }
        cb();
    };
    MicroServiceClient.prototype.addIgnore = function addIgnore(service) {
        var self = this;
        if (service instanceof MicroService && self.ignore.indexOf(service) === -1) {
            self.reset = true;
            self.ignore.push(service);
            self.resetZapper();
        }
    };
    MicroServiceClient.prototype.removeIgnore = function addIgnore(service) {
        var self = this;
        if (service instanceof MicroService && self.ignore.indexOf(service) > -1) {
            self.reset = true;
            self.ignore.splice(self.ignore.indexOf(service), 1);
            self.resetZapper();
        }
    };
    MicroServiceClient.prototype.getMicroServiceClient = function getMicroServiceClientF() {
        var self = this, facade = {};
        util.bindFuncs(self, facade, ["send", "secureSend", "end", "addIgnore"]);
        return facade;
    };

    //////////////
    // Exports  //
    //////////////
    module.exports = {
        "service": getService,
        "client": getMicroServiceClient,
        "util": util
    };

}());