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
  createdAt: string
}

interface Repo {
  name: string
  ssh_url: string
  created_at: string
  archived: boolean
  disabled: boolean
  visibility: string
}

interface Package {
  name: string
  devDependencies: Record<string, string>
  dependencies: Record<string, string>
}

dotenv.config()

const exec = util.promisify(_exec)
const TOKEN = process.env.GITHUB_API_TOKEN
const octokit = new Octokit({ auth: TOKEN })
const term = terminal.terminal

// Run app
; (async () => run())()

async function run() {
  let repos: Repo[] | null = await getCache()
  if (repos?.length === 0) {
    repos = await getAllRepos()
    saveCache(repos)
  }

  const data = await analyzeAllRepos(repos)
  await saveReportData(data)
  await generateReport()

  term("\n")
  term.cyan("ALL DONE\n")
  process.exit()
}

async function getCache(): Promise<Repo[]> {
  const cacheFile = ".cache/data.json"
  try {
    const data = await fs.readFile(cacheFile, "utf8")
    return JSON.parse(data)
  }
  catch (e) {
    return []
  }
}

async function saveCache(repos: Repo[]) {
  try {
    await fs.mkdir(".cache")
  } catch (e) { }
  fs.writeFile(".cache/data.json", JSON.stringify(repos))
}

async function analyzeAllRepos(repos: Repo[]): Promise<Results[]> {
  const limit = parseInt(getenv("LIMIT", "999"))
  let count = 0
  const results: Results[] = []

  const progressBar = term.progressBar({
    width: 80,
    title: "Scanning repos:",
    eta: true,
    percent: true
  })

  for (const repo of repos) {
    if (count >= limit) break

    const data = await analyzeRepo(repo)
    if (data.lib !== "none") {
      results.push(data)
    }

    progressBar.update(count / repos.length)
    count++
  }

  return results
}

async function getAllRepos(): Promise<Repo[]> {
  let repos: Repo[] = []
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
    repos = [...repos, ...(data as Repo[]).map(d => {
      return {
        ssh_url: d.ssh_url, 
        created_at: d.created_at,
        name: d.name,
        archived: d.archived,
        disabled: d.disabled,
        visibility: d.visibility,
      }
    })]
    page++
  }

  return repos
}

export async function analyzeRepo(repo: Repo): Promise<Results> {
  const results: Results = {
    elements: [],
    count: 0,
    createdAt: repo.created_at,
  }

  await exec(`git clone --depth 1 ${repo.ssh_url} tmp`)

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

  const pkgs = await getAllPackages()

  results.repo = repo.name
  results.lib = await getLibType()

  // TODO: get the total count of react apps (ditto for angular and vue)

  switch (results.lib) {
    case "react":
      results.versions = getVersions(pkgs, "@abgov/react-components")
      for (let el of elements) {
        // React uses TextArea
        if (el === "textarea") el = "text-area"
        const count = await getElementCount(`GoA${camelCase(el, { pascalCase: true })}`, "*.tsx", "*.jsx")
        results.elements.push({ [el]: count })
        results.count += count
      }
      break
    case "angular":
      results.versions = getVersions(pkgs, "@abgov/angular-components")
      for (const el of elements) {
        const count = await getElementCount(`goa-${el}`, "*.html")
        results.elements.push({ [el]: count })
        results.count += count
      }
      break
    case "vue":
      results.versions = getVersions(pkgs, "@abgov/web-components")
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
  const t = new Date()
  const timestamp = t.toISOString()
  results.sort((a, b) => a.count < b.count ? 1 : -1)
  const output = JSON.stringify(results)
  await fs.writeFile(`report/data/${timestamp}.json`, output)
  console.log("report written")
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

function getVersions(pkgs: Package[], lib: string): string[] {
  const versions: string[] = []

  pkgs.forEach(pkg => {
    const libs = [...Object.keys(pkg?.dependencies || {}), ...Object.keys(pkg?.devDependencies || {})]
    libs  
      .filter(l => l.startsWith(lib))
      .forEach(key => {
        const version = pkg.dependencies?.[key] || pkg.devDependencies?.[key]
        if (version) {
          versions.push(version)
        }
      })
  })
  
  return versions
}

async function getAllFilePaths(path: string, name: string): Promise<string[]> {
  const { stdout } = await exec(`find ${path} -path ./node_modules -prune -o -name ${name} -print`)
  const paths = stdout.split("\n")
  return paths.filter(p => p.trim().length > 0)
}

async function getAllPackages(): Promise<Package[]> {
  const pkgs: Package[] = []
  const paths = await getAllFilePaths("./tmp", "package.json")  
  for (const path of paths) {
    const p = await getPackage(path)
    if (p) {
      pkgs.push(p)
    }
  }
  return pkgs
}

async function getPackage(filepath: string): Promise<Package | null> {
  try {
    const raw = await fs.readFile(filepath, "utf8")
    return JSON.parse(raw)
  } catch(e) {
    return null
  }
}