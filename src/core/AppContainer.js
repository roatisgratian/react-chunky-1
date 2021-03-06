import ErrorStackParser     from 'error-stack-parser'
import React, { Component } from 'react'
import { Provider }         from 'react-redux'
import DataStore            from '../data/store'
import * as Errors          from '../errors'
import Container            from './Container'
import { Actions, Selectors, Reducers } from '../data'

export default class AppContainer extends Component {

  constructor(props) {
    super(props)

    this.parseChunks()

    // Initialize the store with custom app reducers
    this.state = { store: DataStore(this.reducers, this.props.logging) }
  }

  get app () {
    return React.cloneElement(this.props.children, {
      initialChunk: this.initialChunk,
      initialRoute: this.initialRoute,
      chunks: this.chunks
    })
  }

  get initialChunk () {
    return this.chunks[this.props.startChunk]
  }

  get initialRoute () {
    const chunk = this.initialChunk
    return (chunk && chunk.routes ? chunk.routes[chunk.startRoute] : undefined)
  }

  get chunks() {
    return this._chunks
  }

  generateSelectors(chunk, selectors) {
    const hasData = Selectors.common.hasData(chunk.name)
    const getData = Selectors.common.getData(chunk.name)
    const hasError = Selectors.common.hasError(chunk.name)
    const getError = Selectors.common.getError(chunk.name)
    const isDone = Selectors.common.isDone(chunk.name)
    const isProgress = Selectors.common.isProgress(chunk.name)

    return {
      [`${chunk.name}HasData`]: hasData,
      [`${chunk.name}Data`]: getData,
      [`${chunk.name}HasError`]: hasError,
      [`${chunk.name}Error`]: getError,
      [`${chunk.name}IsDone`]: isDone,
      [`${chunk.name}IsInProgress`]: isProgress
    }
  }

  generateCacheAction(chunk, action, actionId) {
    if (!action.key || !action.type) {
      return
    }

    switch (action.type) {
      case 'create':
        break
      case 'retrieve':
        return () => Actions.common.getFromCache(`${chunk.name}/${actionId}`, action.key)
      case 'update':
        break
      case 'delete':
        return () => Actions.common.deleteFromCache(`${chunk.name}/${actionId}`, action.key)
      default:
        break
    }
  }

  generateRemoteAction(chunk, action, actionId) {
    if (!action.operation || !chunk.api || !chunk.api[action.operation] || !chunk.operations[action.operation]) {
      return
    }

    const operationProps = chunk.api[action.operation]
    const adapter = chunk.operations[action.operation]
    const operation = (props) => new adapter(Object.assign({}, this.props.api, operationProps, props))

    return (props) => Actions.common.operation(`${chunk.name}/${actionId}`, operation(props))
  }

  generateAction(chunk, action, actionId) {
    switch (action.source) {
      case 'cache':
        return this.generateCacheAction(chunk, action, actionId)
      case 'remote':
        return this.generateRemoteAction(chunk, action, actionId)
      default:
        break
    }
  }

  generateActions(chunk, actions) {
    if (!actions) {
      return {}
    }

    var all = {}

    for (let actionId in actions) {
      var action = actions[actionId]
      if (!action || !action.source) {
        continue
      }

      // Generate the action
      const generatedAction = this.generateAction(chunk, action, actionId)
      if (generatedAction) {
        // Keep track of it if it was successfully generated
        all[actionId] = generatedAction
      }
    }

    return all
  }

  generateContainer(chunk, route) {
    const actions = Object.assign({}, this.generateActions(chunk, route.container.actions))
    const selectors = Object.assign({}, this.generateSelectors(chunk, route.container.selectors))

    return Container(route.screen, selectors, actions, {
      api: this.props.api,
      chunk
    })
  }

  generateReducer(chunk) {
    return Reducers.common.asyncReducer(chunk.name)
  }

  parseChunks() {
    this._reducers = {}

    if (!this.props.chunks) {
      return
    }

    for (let chunkName in this.props.chunks) {
      const chunk = this.props.chunks[chunkName]
      this._reducers = Object.assign(this._reducers, { [chunk.name]: this.generateReducer(chunk) } )

      if (chunk.routes) {
        for (let routeName in chunk.routes) {

          const route = chunk.routes[routeName]
          route.screen = chunk.screens[routeName]

          if (route.screen && route.container) {
            // Resolve containers
            chunk.routes[routeName].screen = this.generateContainer(chunk, route)
          }
        }
      }

      this._chunks = this._chunks || {}
      this._chunks[chunkName] = chunk
    }

    for (let chunkName in this.chunks) {
      const chunk = this.chunks[chunkName]

      if (chunk.routes) {
        for (let routeName in chunk.routes) {

          const route = chunk.routes[routeName]

          if (route.transitions) {
            // Resolve transitions
            for(let transitionName in route.transitions) {
              const transition = route.transitions[transitionName]
              route.transitions[transitionName].route = this.resolveTransitionRoute(transition)
            }
          }
        }
      }
    }
  }

  resolveTransitionRoute(transition) {
    if (!transition.id) {
      return
    }

    const [chunkName, routeId] = transition.id.split("/")
    const chunk = this.chunks[chunkName]

    if (!chunk || !chunk.routes[routeId]) {
      return
    }

    return chunk.routes[routeId]
  }

  get reducers() {
    return this._reducers
  }

  enableGlobalErrorHandler() {
    const self = this
    ErrorUtils.setGlobalHandler((e, isFatal) => {
      // Extract a meaningful stack trace
      const stack = ErrorStackParser.parse(e)

      // Notify the app that an error has occured
      self.setState({ error: e, isErrorFatal: isFatal, errorStack: stack })
    });
  }

  componentDidMount() {
    // this.enableGlobalErrorHandler()
  }

  render() {
    if (React.Children.count(this.props.children) !== 1) {
      throw new Errors.UNABLE_TO_LOAD_APP()
    }

    if (!this.chunks) {
      throw new Errors.UNABLE_TO_LOAD_CHUNKS()
    }

    return (
      <Provider store={this.state.store}>
        { this.app }
      </Provider>
    )
  }
}
