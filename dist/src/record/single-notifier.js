"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const client_1 = require("../client");
/**
 * Provides a scaffold for subscriptionless requests to deepstream, such as the SNAPSHOT
 * and HAS functionality. The SingleNotifier multiplexes all the client requests so
 * that they can can be notified at once, and also includes reconnection funcionality
 * incase the connection drops.
 *
 * @param {Services} services          The deepstream client
 * @param {Options} options     Function to call to allow resubscribing
 *
 * @constructor
 */
class SingleNotifier {
    constructor(services, topic, action, timeoutDuration) {
        this.services = services;
        this.topic = topic;
        this.action = action;
        this.timeoutDuration = timeoutDuration;
        this.requests = new Map();
        this.internalRequests = new Map();
        this.services.connection.onLost(this.onConnectionLost.bind(this));
    }
    /**
   * Add a request. If one has already been made it will skip the server request
   * and multiplex the response
   *
   * @param {String} name An identifier for the request, e.g. a record name
   * @param {Object} response An object with property `callback` or `resolve` and `reject`
   *
   * @public
   * @returns {void}
   */
    request(name, callback) {
        const message = {
            topic: this.topic,
            action: this.action,
            name
        };
        const req = this.requests.get(name);
        if (req === undefined) {
            this.requests.set(name, [callback]);
            if (this.services.connection.isConnected === false) {
                this.services.offlineQueue.submit(message, () => this.services.timeoutRegistry.add({ message }), () => callback(client_1.EVENT.CLIENT_OFFLINE));
                return;
            }
            else {
                this.services.connection.sendMessage(message);
                this.services.timeoutRegistry.add({ message });
            }
            return;
        }
        req.push(callback);
        this.services.timeoutRegistry.add({ message });
    }
    /**
     * Adds a callback to a (possibly) inflight request that will be called
     * on the response.
     *
     * @param name
     * @param response
     */
    register(name, callback) {
        const request = this.internalRequests.get(name);
        if (!request) {
            this.internalRequests.set(name, [callback]);
        }
        else {
            request.push(callback);
        }
    }
    recieve(message, error, data) {
        this.services.timeoutRegistry.remove(message);
        const name = message.name;
        const responses = this.requests.get(name) || [];
        const internalResponses = this.internalRequests.get(name) || [];
        if (!responses && !internalResponses) {
            return;
        }
        for (let i = 0; i < internalResponses.length; i++) {
            internalResponses[i](message);
        }
        this.internalRequests.delete(name);
        // todo we can clean this up and do cb = (error, data) => error ? reject(error) : resolve()
        for (let i = 0; i < responses.length; i++) {
            responses[i](error, data);
        }
        this.requests.delete(name);
        return;
    }
    onConnectionLost() {
        this.requests.forEach(responses => {
            responses.forEach(response => response(client_1.EVENT.CLIENT_OFFLINE));
        });
        this.requests.clear();
    }
}
exports.SingleNotifier = SingleNotifier;
//# sourceMappingURL=single-notifier.js.map