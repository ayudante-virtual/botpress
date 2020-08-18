import bodyParser from 'body-parser'
import { NLU } from 'botpress/sdk'
import cors from 'cors'
import express, { Application } from 'express'
import rateLimit from 'express-rate-limit'
import { createServer } from 'http'
import { validate } from 'joi'
import _ from 'lodash'
import ms from 'ms'
import Engine from 'nlu-core/engine'

import NLUServerGhost from './ghost'
import NLUServerKeyValueStore from './kvs'
import { NLUServerLogger } from './logger'
import ModelService from './model-service'
import { monitoringMiddleware, startMonitoring } from './monitoring'
import TrainService from './train-service'
import TrainSessionService from './train-session-service'
import { authMiddleware, handleErrorLogging, handleUnexpectedError } from './util'
import { TrainInput, TrainInputCreateSchema } from './validation'

export type APIOptions = {
  version: string
  host: string
  port: number
  modelDir: string
  authToken?: string
  limitWindow: string
  limit: number
  adminToken: string
}

const debug = DEBUG('api')
const debugRequest = debug.sub('request')
const cachePolicy = { 'Cache-Control': `max-age=${ms('1d')}` }

const createExpressApp = (options: APIOptions): Application => {
  const app = express()

  // This must be first, otherwise the /info endpoint can't be called when token is used
  app.use(cors())

  app.use(bodyParser.json({ limit: '250kb' }))

  app.use((req, res, next) => {
    res.header('X-Powered-By', 'Botpress')
    debugRequest('incoming ' + req.path, { ip: req.ip })
    next()
  })

  app.use(monitoringMiddleware)
  app.use(handleUnexpectedError)

  if (process.core_env.REVERSE_PROXY) {
    app.set('trust proxy', process.core_env.REVERSE_PROXY)
  }

  if (options.limit > 0) {
    app.use(
      rateLimit({
        windowMs: ms(options.limitWindow),
        max: options.limit,
        message: 'Too many requests, please slow down'
      })
    )
  }

  if (options.authToken?.length) {
    // Both tokens can be used to query the language server
    app.use(authMiddleware(options.authToken, options.adminToken))
  }

  return app
}

export default async function(options: APIOptions) {
  const app = createExpressApp(options)
  const logger = new NLUServerLogger('API')
  const loggerWrapper: NLU.Logger = {
    info: (msg: string) => logger.info(msg),
    warning: (msg: string, err?: Error) => (err ? logger.attachError(err).warn(msg) : logger.warn(msg)),
    error: (msg: string, err?: Error) => (err ? logger.attachError(err).error(msg) : logger.error(msg))
  }

  let engine: Engine
  let nluGhost: NLUServerGhost
  let modelService: ModelService
  let kvs: NLUServerKeyValueStore
  let trainSessionService: TrainSessionService
  let trainService: TrainService
  try {
    engine = new Engine('nlu-server', loggerWrapper)
    nluGhost = new NLUServerGhost()
    modelService = new ModelService(nluGhost, options.modelDir)
    await modelService.init()
    kvs = new NLUServerKeyValueStore(nluGhost, options.modelDir)
    await kvs.init()
    trainSessionService = new TrainSessionService(kvs)
    trainService = new TrainService(logger, engine, modelService, trainSessionService)
  } catch (err) {
    logger.attachError(err).error('an error occured while initializing the server')
    process.exit(1)
  }

  app.get('/info', (req, res) => {
    res.send({
      version: options.version
    })
  })

  const router = express.Router({ mergeParams: true })
  router.post('/train', async (req, res) => {
    try {
      const input: TrainInput = await validate(req.body, TrainInputCreateSchema, {
        stripUnknown: true
      })

      const { topics, entities, language, password } = input
      const intents = _.flatMap(Object.values(topics))
      const modelHash = engine.computeModelHash(intents, input.entities, input.language)
      const modelId = modelService.makeModelId(modelHash, input.language, input.seed)

      // return the modelId as fast as possible
      // tslint:disable-next-line: no-floating-promises
      trainService.train(modelId, password, intents, entities, language)

      return res.send({
        success: true,
        modelId
      })
    } catch (err) {
      res.status(500).send({
        success: false,
        error: err.message
      })
    }
  })

  router.get('/train/:modelId', async (req, res) => {
    try {
      const { modelId } = req.params
      const { password } = req.body
      let session = trainSessionService.getTrainingSession(modelId)
      if (!session) {
        const model = await modelService.getModel(modelId, password ?? '')

        if (!model) {
          return res.status(404).send({
            success: false,
            error: `no model or training could be found for modelId: ${modelId}`
          })
        }

        session = {
          status: 'done',
          progress: 1,
          language: model!.languageCode
        }
      }

      res.send({
        success: true,
        session
      })
    } catch (err) {
      res.status(500).send({
        success: false,
        error: err.message
      })
    }
  })

  router.post('/predict/:modelId', async (req, res) => {
    try {
      const { modelId } = req.params
      const { sentence, password } = req.body

      const model = await modelService.getModel(modelId, password ?? '')
      if (model) {
        await engine.loadModel(model)

        const prediction = await engine.predict(sentence, [], model?.languageCode!)
        engine.unloadModel(model.languageCode)

        return res.send({
          success: true,
          prediction
        })
      }
      res.status(404).send({
        success: false,
        error: `modelId ${modelId} can't be found`
      })
    } catch (err) {
      res.status(404).send({
        success: false,
        error: err.message
      })
    }
  })

  app.use('/', router)
  app.use(handleErrorLogging)

  const httpServer = createServer(app)

  await Promise.fromCallback(callback => {
    const hostname = options.host === 'localhost' ? undefined : options.host
    httpServer.listen(options.port, hostname, undefined, callback)
  })

  logger.info(`NLU Server is ready at http://${options.host}:${options.port}/`)

  if (process.env.MONITORING_INTERVAL) {
    startMonitoring()
  }
}