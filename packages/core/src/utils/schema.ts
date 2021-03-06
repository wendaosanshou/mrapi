import { join } from 'path'
import { buildSchema } from 'type-graphql'
import { getSrcDirFromTSConfig, getDistDirFromTSConfig } from './tools'

export const createSchema = (
  option: any,
  cwd: string,
  modelNames: string[] = [],
) => {
  const config = option.buildSchema
  if (!config) {
    throw new Error(`'buildSchema' not found`)
  }
  const isDev = process.env.NODE_ENV !== 'production'
  const src = getSrcDirFromTSConfig()
  const dist = getDistDirFromTSConfig()
  const generatedDir = isDev
    ? config.resolvers.generated.replace('../', '')
    : config.resolvers.generated.replace(`../${src}`, dist)

  let crudFilePath = []
  if (
    option.schema &&
    Object.prototype.toString.call(option.schema) === '[object Object]'
  ) {
    for (let [key, val] of Object.entries(option.schema)) {
      if (modelNames.includes(key)) {
        const name = key.charAt(0).toUpperCase() + key.slice(1)
        const methods = (val as string[]).map(
          (x) => x.charAt(0).toUpperCase() + x.slice(1),
        )
        crudFilePath = crudFilePath.concat(
          methods.map((m) =>
            join(
              cwd,
              generatedDir,
              `resolvers/crud/**/${m}${name}Resolver.{ts,js}`,
            ),
          ),
        )
      }
    }
  } else {
    crudFilePath = [
      join(cwd, generatedDir, 'resolvers/crud/**/*CrudResolver.{ts,js}'),
    ]
  }

  const relationFilePath = join(
    cwd,
    generatedDir,
    'resolvers/relations/**/*RelationsResolver.{ts,js}',
  )
  const customResolvers = join(
    cwd,
    isDev
      ? config.resolvers.custom
      : config.resolvers.custom.replace(`${src}/`, `${dist}/`),
    '**/*Resolver.{ts,js}',
  )
  delete config.resolvers
  delete option.schema

  return buildSchema({
    ...config,
    resolvers: [...crudFilePath, relationFilePath, customResolvers],
  })
}
