import { TOPIC, Message, EVENT_ACTIONS, ALL_ACTIONS } from '../../binary-protocol/src/message-constants'
import { RESPONSE_TO_REQUEST } from '../../binary-protocol/src/utils'

import { Services, Client, EVENT } from '../client'
import { Options } from '../client-options'

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
export class SingleNotifier {

  private services: Services
  private requests: Map<string, Array<(error?: any, result?: any) => void>>
  private action: ALL_ACTIONS
  private topic: TOPIC
  private timeoutDuration: number
  private internalRequests: Map<string, Array<(message: Message) => void>>

  constructor (services: Services, topic: TOPIC, action: ALL_ACTIONS, timeoutDuration: number) {
    this.services = services
    this.topic = topic
    this.action = action
    this.timeoutDuration = timeoutDuration
    this.requests = new Map()
    this.internalRequests = new Map()

    this.services.connection.onLost(this.onConnectionLost.bind(this))
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
  public request (name: string, callback: (error?: any, result?: any) => void): void {
    const message = {
      topic: this.topic,
      action: this.action,
      name
    }

    const req = this.requests.get(name)
    if (req === undefined) {
      this.requests.set(name, [callback])

      if (this.services.connection.isConnected === false) {
        this.services.offlineQueue.submit(
          message,
          () => this.services.timeoutRegistry.add({ message }),
          () => callback(EVENT.CLIENT_OFFLINE)
        )
        return
      } else {
        this.services.connection.sendMessage(message)
        this.services.timeoutRegistry.add({ message })
      }
      return
    }
    req.push(callback)
    this.services.timeoutRegistry.add({ message })
  }

  /**
   * Adds a callback to a (possibly) inflight request that will be called
   * on the response.
   *
   * @param name
   * @param response
   */
  public register (name: string, callback: (message: Message) => void): void {
    const request = this.internalRequests.get(name)
    if (!request) {
      this.internalRequests.set(name, [callback])
    } else {
      request.push(callback)
    }
  }

  public recieve (message: Message, error?: any, data?: any): void {
    this.services.timeoutRegistry.remove(message)
    const name = message.name as string
    const responses = this.requests.get(name) || []
    const internalResponses = this.internalRequests.get(name) || []
    if (!responses && !internalResponses) {
      return
    }

    for (let i = 0; i < internalResponses.length; i++) {
      internalResponses[i](message)
    }
    this.internalRequests.delete(name)

    // todo we can clean this up and do cb = (error, data) => error ? reject(error) : resolve()
    for (let i = 0; i < responses.length; i++) {
      responses[i](error, data)
    }
    this.requests.delete(name)
    return
  }

  private onConnectionLost (): void {
    this.requests.forEach(responses => {
      responses.forEach(response => response(EVENT.CLIENT_OFFLINE))
    })
    this.requests.clear()
  }
}
