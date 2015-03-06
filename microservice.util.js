/*jslint node:true, bitwise:true, forin:true, regexp:true */
(function () {
    "use strict";
    var objToString = Object.prototype.toString,
        funcString = objToString.call(function () { return; }),
        arrString = objToString.call([]),
        error;
    function isProp(obj, k) {
        return Object.prototype.hasOwnProperty.apply(obj, [k]);
    }
    error = {
        "400": new Error("Bad Request"),
        "401": new Error("Unauthorized"),
        "403": new Error("Forbidden"),
        "404": new Error("Not Found"),
        "405": new Error("Method Not Allowed"),
        "406": new Error("Not Acceptable"),
        "407": new Error("Proxy Authentication Required"),
        "408": new Error("Request Time-out"),
        "409": new Error("Conflict"),
        "410": new Error("Gone"),
        "411": new Error("Length Required"),
        "412": new Error("Precondition Failed"),
        "413": new Error("Request Entity Too Large"),
        "414": new Error("Request-URI Too Large"),
        "415": new Error("Unsupported Media Type"),
        "416": new Error("Requested Range Not Satisfiable"),
        "417": new Error("Expectation Failed"),
        "418": new Error("I'm a teapot"),
        "422": new Error("Unprocessable Entity"),
        "423": new Error("Locked"),
        "424": new Error("Failed Dependency"),
        "425": new Error("Unordered Collection"),
        "426": new Error("Upgrade Required"),
        "428": new Error("Precondition Required"),
        "429": new Error("Too Many Requests"),
        "431": new Error("Request Header Fields Too Large"),
        "500": new Error("Internal Server Error"),
        "501": new Error("Not Implemented"),
        "502": new Error("Bad Gateway"),
        "503": new Error("Service Unavailable"),
        "504": new Error("Gateway Time-out"),
        "505": new Error("HTTP Version Not Supported"),
        "506": new Error("Variant Also Negotiates"),
        "507": new Error("Insufficient Storage"),
        "509": new Error("Bandwidth Limit Exceeded"),
        "510": new Error("Not Extended"),
        "511": new Error("Network Authentication Required"),
    };
    (function () {
        var p;
        for (p in error) {
            if (isProp(error, p)) {
                error[p].code = parseInt(p, 10);
            }
        }
    }());
    function isFunction(val) {
        return val instanceof Function || objToString.call(val) === funcString;
    }
    function asFunction(val) {
        return isFunction(val) ? val : function () { return; };
    }
    function isArray(val) {
        return objToString.call(val) === arrString;
    }
    function isString(val) {
        return typeof val === "string" || String(val) === val;
    }
    function asString(val, def) {
        return isString(val) ? val : isString(def) ? def : "";
    }
    function lower(str) {
        return asString(str).toLowerCase();
    }
    function uuid() {
        return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, function (c) {
            var r = (Math.random() * 16) | 0,
                v = c === "x" ? r : (r & 0x3 | 0x8);
            return v.toString(16);
        });
    }
    function isUUID(val) {
        return isString(val) && !!val.match(/^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i);
    }
    function asUUID(val, def) {
        return isUUID(val) ? lower(val) : isUUID(def) ? lower(def) : def === null ? null : uuid();
    }
    function isInteger(val) {
        return typeof val === "number" || (typeof val === "string" && /^\-?\d+$/.test(val));
    }
    function asInteger(val, def) {
        return isInteger(val) ? Number(val) : isInteger(def) ? Number(def) : 0;
    }
    function isIntegerPositive(val) {
        return isInteger(val) && Number(val) >= 0;
    }
    function asIntegerPositive(val, def, max) {
        max = isIntegerPositive(max) ? max : Number.POSITIVE_INFINITY;
        return Math.min(max, isIntegerPositive(val) ? Number(val) : isIntegerPositive(def) ? Number(def) : 0);
    }
    function makeEventEmitter(ObjType) {
        if (ObjType) {
            var listeners = {},
                once = {},
                oldOn = function () { return; },
                oldOnce = function () { return; },
                oldOff = function () { return; },
                oldListeners = function () { return; },
                oldEmit = function () { return; };
            if (isFunction(ObjType.on)) { oldOn = ObjType.on; }
            if (isFunction(ObjType.off)) { oldOff = ObjType.off; }
            if (isFunction(ObjType.emit)) { oldEmit = ObjType.emit; }
            ObjType.on = function onF(actions, listener) {
                if (isString(actions) && isFunction(listener)) {
                    actions.split(" ").forEach(function (action) {
                        listeners[action] = listeners[action] || [];
                        if (listeners[action].indexOf(listener) === -1) {
                            listeners[action].push(listener);
                        }
                    });
                }
                oldOn.apply(ObjType, arguments);
            };
            ObjType.once = function onceF(actions, listener) {
                if (isString(actions) && isFunction(listener)) {
                    actions.split(" ").forEach(function (action) {
                        var func;
                        listeners[action] = listeners[action] || [];
                        once[action] = once[action] || [];
                        if (listeners[action].indexOf(listener) === -1 &&
                                once[action].indexOf(listener) === -1) {
                            func = function () {
                                listeners[action].splice(listeners[action].indexOf(func), 1);
                                once[action].splice(once[action].indexOf(listener), 1);
                                listener.apply(listener, arguments);
                            };
                            listeners[action].push(func);
                            once[action].push(listener);
                        }
                    });
                }
                oldOnce.apply(ObjType, arguments);
            };
            ObjType.off = function offF(actions, listener) {
                if (isString(actions) && isFunction(listener)) {
                    actions.split(" ").forEach(function (action) {
                        listeners[action] = listeners[action] || [];
                        if (listeners[action].indexOf(listener) > -1) {
                            listeners[action].splice(listeners[action].indexOf(listener), 1);
                        }
                    });
                }
                oldOff.apply(ObjType, arguments);
            };
            ObjType.listeners = function off(action) {
                var ret = [];
                if (isString(action) && listeners[action]) {
                    ret = listeners[action].slice();
                }
                oldListeners.apply(ObjType, arguments);
                return ret;
            };
            ObjType.emit = function emit() {
                var args = Array.prototype.slice.apply(arguments), action = args.shift(), cb;
                if (listeners[action]) {
                    listeners[action].slice().forEach(function (func) {
                        try {
                            func.apply(func, args);
                        } catch (ignore) {}
                    });
                } else {
                    cb = args.pop();
                    if (isFunction(cb)) {
                        cb(error["405"]);
                    }
                }
                oldEmit.apply(ObjType, arguments);
            };
        }
        return ObjType;
    }
    module.exports = {
        "isProp": isProp,
        "isFunction": isFunction,
        "asFunction": asFunction,
        "isArray": isArray,
        "isString": isString,
        "asString": asString,
        "uuid": uuid,
        "isUUID": isUUID,
        "asUUID": asUUID,
        "isInteger": isInteger,
        "asInteger": asInteger,
        "isIntegerPositive": isIntegerPositive,
        "asIntegerPositive": asIntegerPositive,
        "makeEventEmitter": makeEventEmitter,
        "error": error
    };

}());
