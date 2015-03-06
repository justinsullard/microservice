# microservice

A simple service to create and connect to microservices via dnode and polo.

This is a work in progress and further documentation will be coming in the next version

# example microservice

    var microservice = require("microservice");
    microservice.service("my-service", "0.0.1", function (e, service) {
        if (e) {
            return console.error("Error creating micro service");
        }
        service.on("hello", function (cb) {
            cb(null, "Howdy from " + service.get("service_address"));
        });
    });

# example microservice with port range

This example creates a microservice with a port in the provided range of 5000-6000

    var microservice = require("microservice");
    microservice.service("my-service", "0.0.1", null, [5000, 6000], function (e, service) {
        if (e) {
            return console.error("Error creating micro service");
        }
        service.on("hello", function (cb) {
            cb(null, "Howdy from " + service.get("service_address"));
        });
    });

# license

MIT/X11
