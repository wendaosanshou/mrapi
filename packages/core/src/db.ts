import { requireFromProject } from './utils/tools'
import { checkPrismaClient } from './utils/prisma'
import { generate, getUrlAndProvider } from './utils/prisma'
import { log } from './utils/logger'
import { MrapiOptions, Request, Reply } from './types'

import { MultiTenant } from 'prisma-multi-tenant'
import { PrismaClient as PrismaClientType } from '@prisma/client'
import migrate from 'prisma-multi-tenant/build/cli/commands/migrate'

export const getDBClients = async ({
  database,
  server,
  plugins,
}: MrapiOptions) => {
  // load '@prisma/client' from user's project folder
  const clientValid = checkPrismaClient()
  if (!clientValid) {
    log.warn(`prisma client isn't ready. generate now...`)
    await generate({ database, server, plugins })
  }
  const { PrismaClient } = requireFromProject('@prisma/client')

  if (database.multiTenant) {
    const managementInfo = getUrlAndProvider(
      database.multiTenant.management.url,
    )
    log.info(
      `[mrapi] using multiple tenants, management database url: ${managementInfo.url}`,
    )
    process.env.MANAGEMENT_URL = managementInfo.url
    process.env.MANAGEMENT_PROVIDER = managementInfo.provider
    await migrate.migrateManagement('up', '--create-db')

    process.env.verbose = 'false'
    const multiTenant = new MultiTenant<PrismaClientType>({
      tenantOptions: {
        ...(database.prismaClient || {}),
      },
    })

    if (Array.isArray(database.multiTenant.tenants)) {
      for (let tenant of database.multiTenant.tenants) {
        const name = tenant.name.trim()
        if (!(await multiTenant.existsTenant(name))) {
          const tenantInfo = getUrlAndProvider(tenant.url)
          await multiTenant.createTenant(
            {
              name,
              url: tenantInfo.url,
              provider: tenantInfo.provider,
            },
            {
              datasources: { db: tenant.url },
            },
          )
        }
      }
    }

    return { multiTenant }
  }

  const datasources = process.env.DATABASE_URL
    ? {
        db: process.env.DATABASE_URL,
      }
    : database.url
    ? {
        db: database.url,
      }
    : {}
  if (Object.keys(datasources).length > 0) {
    log.info(`[mrapi] connected to ${datasources.db}`)
  }
  const clientOptions = {
    ...(database.prismaClient || {}),
    datasources,
    __internal: {
      hooks: {
        beforeRequest(opts) {
          if (!opts.document || opts.document.type !== 'query') {
            return
          }
          // fix prisma query bug: skip: -1,  PANIC: called `Result::unwrap() TryFromIntError`
          const children = opts.document.children
          for (let child of children) {
            const args = child.args.args
            for (let arg of args) {
              if (['skip', 'first', 'last'].includes(arg.key)) {
                if (arg.value < 0) {
                  throw new Error(
                    `argument '${arg.key}' must be a positive integer`,
                  )
                }
              }
            }
          }
        },
      },
    },
  }

  log.info(`[mrapi] using single prisma client`)

  return {
    prismaClient: new PrismaClient(clientOptions),
  }
}

export const getDBClient = async ({
  prismaClient,
  multiTenant,
  options,
  request,
  reply,
}: {
  prismaClient: PrismaClientType
  multiTenant: MultiTenant<PrismaClientType>
  options: MrapiOptions
  request: Request
  reply: Reply
}) => {
  let client = prismaClient
  if (client) {
    return client
  }

  const identifier = options.database.multiTenant.identifier
  if (!identifier) {
    throw new Error(`'multiTenant.identifier' is required`)
  }
  if (typeof identifier !== 'function') {
    throw new Error(`'multiTenant.identifier' should be a function`)
  }

  let tenantId = await identifier(request, reply)
  if (tenantId) {
    try {
      client = await multiTenant.get(tenantId)
    } catch (err) {
      throw new Error(`get tenant client error. ${err}`)
    }
  } else {
    throw new Error(`tenant id is required`)
  }

  if (!client) {
    throw new Error(`cannot resolve multiple tenant client`)
  }

  return client
}
