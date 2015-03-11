/*jslint node:true, unparam: true */
(function () {
    "use strict";
    var microservice = require("../microservice"),
        generalservice,
        generalclient,
        specificservice,
        specificclient,
        delay_time = 2000,
        extra_time = 5000;

    // It's a pet peeve of mine to have the ^C left at the beginning of my command prompt when I exit a script
    process.once('SIGINT', function () {
        console.log("\n");
        process.exit();
    });
    // Slightly shorter
    function stamp() { return new Date().toISOString(); }

    /*
        ## example microservice
     */
    microservice.service("my-service", "0.0.1", function (e, service) {
        if (e) {
            return console.error(stamp(), "Error creating general micro service", e);
        }
        console.log(stamp(), "Microservice started", service.get("service_address"));
        generalservice = service;
        generalservice.on("hello", function (cb) {
            cb(null, "Howdy from " + generalservice.get("service_address") + " @ " + stamp());
        });
        generalservice.on("call-func", function (func, cb) {
            func("Called from " + generalservice.get("service_address") + " @ " + stamp());
            cb(null);
        });
        // Here we an add generalservice to the specificclient ignore list
        if (specificclient) {
            specificclient.addIgnore(generalservice);
        }
        console.log("generalservice:", generalservice);
    });
    /*
        ## example microservice client

        This example creates a microservice client
     */
    generalclient = microservice.client([], "my-service", "0.0.x");

    /*
        ## example microservice with a specific host and port range

        This example creates a microservice with a port in the provided range of 5000-6000
     */
    microservice.service("my-service", "0.0.2", "127.0.0.1", [5000, 6000], function (e, service) {
        if (e) {
            return console.error(stamp(), "Error creating micro service", e);
        }
        console.log(stamp(), "Microservice started", service.get("service_address"));
        specificservice = service;
        specificservice.on("hello", function (cb) {
            cb(null, "Howdy from " + specificservice.get("service_address") + " @ " + stamp());
        });
        // Here we an add specificservice to the generalclient ignore list
        if (generalclient) {
            generalclient.addIgnore(specificservice);
        }
        console.log("specificservice:", specificservice);
    });
    /*
        ## example microservice client with port range

        This example creates a microservice client in a specified port range
     */
    specificclient = microservice.client([], "my-service", "~0.0.1", "127.0.0.1", [5000, 6000]);

    /*
        ## Now we'll setup a pair of loops to get them chatting
     */
    process.nextTick(function () {
        // For the generalclient let's use both send and secureSend so we can compare the time difference
        // There is definitely a noticeable lag for secureSend as messages are being encrypted each direction
        (function generalchatter() {
            setTimeout(generalchatter, delay_time + Math.round(Math.random() * extra_time));
            if (!generalclient) { return; }
            console.log(stamp(), "Saying hello via generalclient.secureSend");
            generalclient.secureSend("hello", function (e, reply) {
                if (e) {
                    return console.error(stamp(), "Error saying hello via generalclient.secureSend", e);
                }
                console.log(stamp(), "Reply received via generalclient.secureSend:", reply);
            });
            generalclient.send("call-func", function (message) {
                console.log(stamp(), "call-func provided function called via generalclient.send:", message);
            }, function (e) {
                if (e) {
                    return console.error(stamp(), "Error sending call-func via generalclient.send", e);
                }
                console.log(stamp(), "call-func completed via generalclient.send");
            });
        }());
        (function specificchatter() {
            setTimeout(specificchatter, delay_time + Math.round(Math.random() * extra_time));
            if (!specificclient) { return; }
            console.log(stamp(), "Saying hello via specificclient.send");
            specificclient.send("hello", function (e, reply) {
                if (e) {
                    return console.error(stamp(), "Error saying hello via specificclient.send", e);
                }
                console.log(stamp(), "Reply received via specificclient.send:", reply);
            });
        }());
    });

    console.log("generalclient:", generalclient);
    console.log("specificclient:", specificclient);

}());
