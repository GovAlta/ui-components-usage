import { Octokit } from "@octokit/core"
import getenv from "getenv"
import fs from "fs/promises"
import util from "node:util"
import { exec as _exec } from "child_process"
import camelCase from "camelcase"
import terminal from "terminal-kit"
import dotenv from "dotenv"
import { generateReport } from "./report/generate"

type LibType = "react" | "angular" | "vue" | "none"

interface Results {
  repo?: string
  lib?: LibType
  versions?: string[]
  count: number
  elements: Record<string, number>[]
}

dotenv.config()

const exec = util.promisify(_exec)
const TOKEN = process.env.GITHUB_API_TOKEN
const octokit = new Octokit({ auth: TOKEN })
const term = terminal.terminal

// Run app
; (async () => run())()

async function run() {
  let urls: string[] | null = await getCache()

  if (urls?.length === 0) {
    urls = await getAllRepos()
    saveCache(urls)
  }

  const data = await fetchData(urls)
  await saveReportData(data)
  await generateReport()

  term("\n")
  term.cyan("ALL DONE\n")
  process.exit()
}

async function getCache(): Promise<string[]> {
  const cacheFile = ".cache/data.json"
  try {
    const data = await fs.readFile(cacheFile, "utf8")
    return JSON.parse(data)
  }
  catch (e) {
    return []
  }
}

async function saveCache(urls: string[]) {
  try {
    await fs.mkdir(".cache")
  } catch (e) { }
  fs.writeFile(".cache/data.json", JSON.stringify(urls))
}

async function fetchData(urls: string[]): Promise<Results[]> {
  const limit = parseInt(getenv("LIMIT", "999"))
  let count = 0
  const results: Results[] = []

  const progressBar = term.progressBar({
    width: 80,
    title: "Scanning repos:",
    eta: true,
    percent: true
  })

  for (const url of urls) {
    if (count >= limit) break

    const data = await analyzeRepo(url)
    if (data.lib !== "none") {
      results.push(data)
    }

    progressBar.update(count / urls.length)
    count++
  }

  return results
}

async function getAllRepos(): Promise<string[]> {
  let urls: string[] = []
  let page = 1

  while (true) {
    const { data } = await octokit.request("GET /orgs/govalta/repos", {
      per_page: 100,
      page,
      headers: {
        "X-GitHub-Api-Version": "2022-11-28"
      }
    })

    if (data.length === 0) {
      break
    }
    urls = [...urls, ...(data as { ssh_url: string }[]).map(d => d.ssh_url)]
    page++
  }

  return urls
}

export async function analyzeRepo(repo: string): Promise<Results> {
  const results: Results = {
    elements: [],
    count: 0,
  }

  await exec(`git clone --depth 1 ${repo} tmp`)

  results.repo = repo
    .replace("git@github.com:GovAlta/", "")
    .replace(".git", "")
  results.lib = await getLibType()

  const elements = [
    "accordion",
    "badge",
    "button",
    "button-group",
    "callout",
    "checkbox",
    "chip",
    "circular-progress",
    "container",
    "details",
    "dropdown",
    "form-stepper",
    "hero-banner",
    "icon",
    "icon-button",
    "input",
    "modal",
    "notification",
    "pagination",
    "popover",
    "radio",
    "skeleton",
    "table",
    "textarea",
    "app-footer",
    "app-header",
    "microsite-header",
    "block",
    "divider",
    "form-item",
    "grid",
    "spacer",
    "one-column-layout",
    "two-column-layout",
  ]

  switch (results.lib) {
    case "react":
      results.versions = await getVersions("@abgov/react-components")
      for (let el of elements) {
        // React uses TextArea
        if (el === "textarea") el = "text-area"
        const count = await getElementCount(`GoA${camelCase(el, { pascalCase: true })}`, "*.tsx", "*.jsx")
        results.elements.push({ [el]: count })
        results.count += count
      }
      break
    case "angular":
      results.versions = await getVersions("@abgov/angular-components")
      for (const el of elements) {
        const count = await getElementCount(`goa-${el}`, "*.html")
        results.elements.push({ [el]: count })
        results.count += count
      }
      break
    case "vue":
      results.versions = await getVersions("@abgov/web-components")
      for (const el of elements) {
        const count = await getElementCount(`goa-${el}`, "*.vue")
        results.elements.push({ [el]: count })
        results.count += count
      }
      break
  }

  await exec('rm -rf tmp')

  return results
}

async function saveReportData(results: Results[]) {
  try {
    await fs.mkdir("data")   
  } catch(e) {}

  const t = new Date()
  const timestamp = t.toISOString()
  results.sort((a, b) => a.count < b.count ? 1 : -1)
  const output = JSON.stringify(results)
  await fs.writeFile(`data/${timestamp}.json`, output)
}

// Content Helpers

async function getLibType(): Promise<LibType> {
  if (await isReactApp()) return "react"
  if (await isAngularApp()) return "angular"
  if (await isVueApp()) return "vue"
  return "none"
}

async function isReactApp(): Promise<boolean> {
  const linecount = await getCount("@abgov/react-components", "package.json")
  return linecount > 0
}

async function isAngularApp(): Promise<boolean> {
  const linecount = await getCount("@abgov/angular-components", "package.json")
  return linecount > 0
}

async function isVueApp(): Promise<boolean> {
  const isWeb = await getCount("@abgov/web-components", "package.json") > 0
  const isVue = await getCount("vue", "package.json") > 0
  return isWeb && isVue
}

async function getCount(text: string, ...fileFilter: string[]): Promise<number> {
  const includes = fileFilter
    .map(filter => `--include ${filter}`)
    .join(" ")
  const { stdout } = await exec(`grep ${includes} -r "${text}" tmp | wc -l`)
  return parseInt(stdout)
}

// TODO: allow for an exclude filter to be passed in
async function getElementCount(text: string, ...fileFilter: string[]): Promise<number> {
  const includes = fileFilter
    .map(filter => `--include \\${filter}`)
    .join(" ")
  const { stdout } = await exec(`grep ${includes} -r "<${text}[ >]" tmp | wc -l`)
  return parseInt(stdout)
}

async function getVersions(lib: string): Promise<string[]> {
  const { stdout } = await exec(`grep --include package.json -r ${lib} tmp`)
  const lines = stdout.split("\n")
  const versions = lines.map(line => line.split(":").pop()?.trim())
  return versions
    .map(item => (item || "").replace(/[",]/g, "") )
    .filter(item => item.length > 0)
}