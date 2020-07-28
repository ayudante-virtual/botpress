import { Button } from '@blueprintjs/core'
import { NLUApi } from 'api'
import { lang } from 'botpress/shared'
import React, { FC, useEffect, useState } from 'react'

import { NLUProgressEvent } from '../../../backend/typings'

const TrainNow: FC<{ api: NLUApi; eventBus: any; autoTrain: boolean }> = ({ api, eventBus, autoTrain }) => {
  const [loading, setLoading] = useState(true)
  const [training, setTraining] = useState(false)
  const [cancelling, setCancelling] = useState(false)

  useEffect(() => {
    const fetchIsTraining = async () => {
      setLoading(true)
      const isTraining = await api.isTraining()
      setTraining(isTraining)
      setLoading(false)
    }

    // tslint:disable-next-line: no-floating-promises
    fetchIsTraining()
  }, [])

  const isDoneOrCancelled = (event: NLUProgressEvent) => {
    return event.trainSession.status === 'done' || event.trainSession.status === 'canceled'
  }

  useEffect(() => {
    eventBus.on('statusbar.event', event => {
      if (event.type === 'nlu' && isDoneOrCancelled(event as NLUProgressEvent)) {
        setTraining(false)
        setCancelling(false)
      }
    })
  }, [])

  const trainNow = async () => {
    setTraining(true)
    await api.train()
  }

  const cancelTraining = async () => {
    await api.cancelTraining()
    setCancelling(true)
  }

  if (training) {
    return (
      <Button disabled={cancelling} loading={loading} onClick={cancelTraining}>
        {lang.tr('module.nlu.cancelTraining')}
      </Button>
    )
  }

  return (
    <Button loading={loading} onClick={trainNow}>
      {lang.tr(autoTrain ? 'module.nlu.retrainAll' : 'module.nlu.trainNow')}
    </Button>
  )
}

export default TrainNow
