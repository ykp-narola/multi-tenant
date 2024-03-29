const Queue = require('bull')
const { db } = require('../config/database')
const migrate = require('../migrations')
const seed = require('../seeders')
const { bootstrap, getTenantConnection } = require('./connection-service')

const up = async (params) => {
  try {
    const job = new Queue(
      `setting-up-database-${new Date().getTime()}`,
      {
        redis: {
          host: process.env.REDIS_HOST, 
          port: process.env.REDIS_PORT, 
          password: process.env.REDIS_PASSWORD 
        }
      }
    )
    job.add({
      ...params
    },{
      removeOnComplete: true,
      removeOnFail: true
    })
    job.process(async (job, done) => {
      try {
        await db.raw(`CREATE ROLE ${params.tenantName} WITH LOGIN;`)
        await db.raw(
          `GRANT ${params.tenantName} TO ${process.env.DB_USER};`
        )
        await db.raw(`CREATE DATABASE ${params.tenantName};`)
        await db.raw(
          `GRANT ALL PRIVILEGES ON DATABASE ${params.tenantName} TO ${params.tenantName};`
        )
  
        await bootstrap()
        const tenant = getTenantConnection(params.uuid)
        await migrate(tenant)
        await seed(tenant)
        console.log("created tenant");
        done()
      } catch (e) {
        console.log(e)
      }
    })
  } catch (error) {
    console.log('error :>> ', error);
  }
}

const down = async (params) => {
  const job = new Queue(
    `deleting-database-${new Date().getTime()}`,
    {
      redis: {
        host: process.env.REDIS_HOST, 
        port: process.env.REDIS_PORT, 
        password: process.env.REDIS_PASSWORD 
      }
    }
  )

  job.add({
    ...params
  },{
    removeOnComplete: true,
    removeOnFail: true
  })
  job.process(async (job, done) => {
    try {
      await db.raw(
        `SELECT pg_terminate_backend(pid) FROM pg_stat_activity
        WHERE pid <> pg_backend_pid()
        AND datname = '${params.tenantName}';`
      )
      await db.raw(`DROP DATABASE IF EXISTS ${params.tenantName};`)
      await db.raw(`DROP ROLE IF EXISTS ${params.tenantName};`)
      await bootstrap()
      done()
    } catch (e) {
      console.error(e)
    }
  })
}

module.exports = { up, down }
