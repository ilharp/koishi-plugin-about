import type { SpawnOptions } from 'child_process'
import { spawn } from 'child_process'
import type { Context, Logger } from 'koishi'
import { Schema } from 'koishi'
import { join } from 'node:path'

export const name = 'about'

const scrapers = {
  scrapeProject,
  scrapeGitVersion,
  scrapeKoishiVersion,
} as const

type Scrapers = typeof scrapers
type ScraperName = keyof Scrapers

const removeScrapePrefix = <T extends `scrape${string}`>(x: T) =>
  x.slice(6) as T extends `scrape${infer S}` ? S : never

const scraperList = (
  Object.keys(scrapers) as unknown as Array<ScraperName>
).map(removeScrapePrefix)

export interface Config {
  scrapers: typeof scraperList
}

export const Config: Schema<Config> = Schema.object({
  scrapers: Schema.array(Schema.union(scraperList))
    .default(scraperList)
    .role('checkbox'),
})

const localeDict = {
  commands: {
    about: {
      template: `
{project.name} - {project.description}
版本：{project.version}
框架：Koishi v{koishiVersion}
`.trim(),
      messsages: {
        unknown: '（未知）',
      },
    },
  },
} as const

interface ScrapeContext {
  ctx: Context
  localeDict: typeof localeDict
  l: Logger
}

export async function apply(ctx: Context, config: Config) {
  const l = ctx.logger('about')

  ctx.i18n.define('zh-CN', localeDict)

  const sctx: ScrapeContext = {
    ctx,
    localeDict,
    l,
  }

  const result = Object.assign(
    {},
    ...(await Promise.all(
      config.scrapers.map(async (x) => {
        const key = x[0].toLowerCase() + x.slice(1)
        return {
          [key]: await scrapers[('scrape' + x) as ScraperName](sctx),
        }
      }),
    )),
  ) as Record<string, unknown>

  l.warn(result)

  ctx
    .command('about')
    .action(({ session }) => session.text('commands.about.template', result))
}

async function scrapeGitVersion({ localeDict, l }: ScrapeContext) {
  let version = ''

  try {
    version += (
      await spawnOutput('git', ['describe', '--tags', '--dirty'])
    ).trim()
  } catch (e) {
    l.warn('failed to get version:')
    l.warn(e)
    return localeDict.commands.about.messsages.unknown
  }

  try {
    version += ` (build ${(
      await spawnOutput('git', ['rev-list', '--count', 'HEAD'])
    ).trim()})`
  } catch (e) {
    l.warn('failed to get build number')
    l.warn(e)
    return localeDict.commands.about.messsages.unknown
  }

  return version
}

async function scrapeProject({ l }: ScrapeContext) {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const project = require(join(process.cwd(), 'package.json')) as Record<
      string,
      unknown
    >

    return project
  } catch (e) {
    l.warn('failed to get project info')
    l.warn(e)
    return {}
  }
}

async function scrapeKoishiVersion({ localeDict, l }: ScrapeContext) {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { version: koishiVersion } = require(
      require.resolve('koishi/package.json'),
    ) as {
      version: string
    }

    return koishiVersion
  } catch (e) {
    l.warn('failed to get koishi version')
    l.warn(e)
    return localeDict.commands.about.messsages.unknown
  }
}

export async function spawnOutput(
  command: string,
  args?: ReadonlyArray<string>,
  options?: SpawnOptions,
): Promise<string> {
  const parsedArgs = args ?? []
  const parsedOptions: SpawnOptions = Object.assign<
    SpawnOptions,
    SpawnOptions,
    SpawnOptions | undefined
  >({}, { stdio: 'pipe', shell: true }, options)
  const child = spawn(command, parsedArgs, parsedOptions)
  let stdout = ''
  if (!child.stdout)
    throw new Error(`cannot get stdout of ${command} ${parsedArgs.join(' ')}`)
  child.stdout.on('data', (x) => (stdout += x))
  return new Promise<string>((resolve, reject) => {
    child.on('close', (x) => {
      if (x) reject(x)
      else resolve(stdout)
    })
  })
}
