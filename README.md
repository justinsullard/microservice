# jss-microservice

A simple service to create and connect to micro services via dnode and polo.

This is a work in progress and documentation will be filled in as the project progresses.

# microservice methods

## getService(name, semver, host, port, callback)

The **getService** method will attempt to start a new **MicroService** instance per the provided configuration and will return an error if it is unable to.

### getService arguments:

* **name** : *optional* Defaults to `"microservice"`
* **semver** : *optional* Defaults to `"0.0.0"`
* **host** : *optional* Defaults to first available IPv4 address identified or `"127.0.0.1"`
* **port** : *optional* Defaults to a random value between `10000` and `15000`
* **callback** : *required* Executed when the service is either generated or an error is encountered during startup. Signature is `callback(error, service)`.

The **port** may be provided as any positive integer like value (yes, this means you can provide an invalid port value, which will result in failure to start the service, and yes, you can provide a string). You may also provide a two element array of a range of ports you would like to select randomly from (order doesn't matter, it will sort them for you), again as positive integer like values.

### MicroService methods:

* `start(cb)` : cb is optional and will be called when successful, signature is `cb(err, server)`
* `stop()` : Stop the service from running.
* `get(prop)` : prop is a string as listed below
* `on(event, callback)` : Register a listener for an event.
* `off(event, callback)` : Remove a listener for an event.
* `once(event, callback)` : Register a one-time listener for an event.
* `listeners(event)` : Return an array of listeners registered for an event.
* `emit(event [,args])` : Emit an event.
* `toJSON` : Just provided for posterity

### properties available via `get(prop)`:

* **name** : < string >
* **version** : < string >
* **host** : < string >
* **port** : < number >
* **full_name** : < string > (name@version)
* **service_address** : < string > (name@version/host:port)
* **running** : < boolean >

The **MicroService** class operates much like an **EventEmitter**, but this is a custom implementation.

## getClient(ignore, name, range, host, port)

The **getClient** method will create a new **MicroServiceClient** through which requests can be made to a service. The provided client will automatically disconnect when idle for more than 2 seconds (but will wait to disconnect until all pending requests have been satisfied). It connects only when requests are made and will automatically timeout and close the connection when idle for 5 seconds. It is possible to generate a client with invalid input, it simply won't be able to connect.

### getClient arguments:

* **ignore** : *required* An array of MicroService instances to ignore for this client
* **name** : *required* The service name to look for
* **semver** : *required* A valid semver range to match services against
* **host** : *optional* An optional host to filter services on
* **port** : *optional* A port or range of ports to filter services on, see getService for details on the format.

### MicroServiceClient methods:

* `send(message [, args ...], cb)` : Send a message to a service. As this is a dnode service, functions can be sent as arguments (just make sure you send a callback along the way as well...).
* `secureSend(message [, args ...], cb)` : Send a message through a single use encrypted tunnel. Due to the encryption technique used functions cannot be sent at the moment (I will be working on overcoming this shortcoming soon).
* `addIgnore(service)` : Add a MicroService instance to the ignore list for this client.
* `removeIgnore(service)` : Not available yet, but coming soon.
* `end()` : Disconnect as soon as possible. Will delay until all messages have been sent.

# example microservice

    var microservice = require("jss-microservice");
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

    var microservice = require("jss-microservice");
    microservice.service("my-service", "0.0.1", null, [5000, 6000], function (e, service) {
        if (e) {
            return console.error("Error creating micro service");
        }
        service.on("hello", function (cb) {
            cb(null, "Howdy from " + service.get("service_address"));
        });
    });

# example microservice client

    var microservice = require("jss-microservice"),
        client;
    client = microservice.client([], "my-service", "^0.0.1");
    client.send("hello", function (e, response) {
        if (e) {
            return console.error("error in hello request", e);
        }
        console.log("Got back response", response);
    });
    client.secureSend("hello", function (e, response) {
        if (e) {
            return console.error("error in hello request", e);
        }
        console.log("Got back response", response);
    });

# example microservice client with port range

    var microservice = require("jss-microservice"),
        client;
    client = microservice.client([], "my-service", "~0.0.1", null, [5000, 6000]);
    client.send("hello", function (e, response) {
        if (e) {
            return console.error("error in hello request", e);
        }
        console.log("Got back response", response);
    });


# license

MIT/X11
