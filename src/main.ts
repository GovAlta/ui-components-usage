import { Octokit } from "@octokit/core"
import getenv from "getenv"
import fs from "fs/promises"
import util from "node:util"
import { exec as _exec } from "child_process"
import camelCase from "camelcase"
import terminal from "terminal-kit"
import dotenv from "dotenv"
import { generateReport } from "./report/generate"

type LibType =  
    "react-uic" 
  | "angular-uic" 
  | "vue-uic" 
  | "wc-uic" 
  | "react-uic-old" 
  | "angular-uic-old" 
  | "vue-uic-old"
  | "react" 
  | "angular" 
  | "vue" 
  | "none"

interface Report {
  stats: Stats
  data: Results[]
}

interface Stats {
  totalLibCount: number
  reactCount: number
  angularCount: number
  vueCount: number
  reactUICLibCount: number
  angularUICLibCount : number
  vueUICLibCount: number
  wcUICLibCount: number
  reactUICLibCountOld: number
  angularUICLibCountOld: number
  vueUICLibCountOld: number
}

interface Results {
  repo?: string
  html_url?: string
  lib?: LibType
  versions?: string[]
  count: number
  elements: Record<string, number>
  createdAt: string
  updatedAt: string
  pushedAt: string
}

interface Repo {
  name: string
  html_url: string
  ssh_url: string
  created_at: string
  updated_at: string
  pushed_at: string
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

const reactLatestMatcher = /4\.\d{1,2}\.\d{1,2}/
const angularLatestMatcher = /2\.\d{1,2}\.\d{1,2}/
const vueLatestMatcher = /1\.\d{1,2}\.\d{1,2}/

const stats: Stats = {
  totalLibCount: 0,
  reactCount: 0,
  angularCount: 0,
  vueCount: 0, 
  reactUICLibCount: 0,
  angularUICLibCount : 0,
  vueUICLibCount: 0,
  wcUICLibCount: 0,
  reactUICLibCountOld: 0,
  angularUICLibCountOld: 0,
  vueUICLibCountOld: 0,
}

// Run app
; (async () => run())()

async function run() {
  let repos: Repo[] | null = await getCache()
  if (repos?.length === 0) {
    repos = await getAllRepos()
    saveCache(repos)
  }

  const data = await analyzeAllRepos(repos)
  const report: Report = {
    data,  
    stats
  }
  await saveReportData(report)
  await generateReport()

  term("\n")
  term.cyan("ALL DONE\n")
  process.exit()
}

async function getCache(): Promise<Repo[]> {
  const limit = getenv("LIMIT", "")
  const cacheFile = limit ? ".cache/data.limit.json" : ".cache/data.json"
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
      data.html_url = repo.html_url
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
        html_url: d.html_url,
        ssh_url: d.ssh_url, 
        created_at: d.created_at,
        updated_at: d.updated_at,
        pushed_at: d.pushed_at,
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
    lib: "none",
    elements: {},
    count: 0,
    createdAt: repo.created_at,
    updatedAt: repo.updated_at,
    pushedAt: repo.pushed_at,
  }

  console.log("cloning", repo.ssh_url)
  try {
    await exec(`git clone --depth 1 ${repo.ssh_url} tmp`)
  } catch (e) {
    console.error(e) 
    return results;
  }

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
  results.lib = getLibType(pkgs)

  stats.totalLibCount += 1 // optimistically increment this value (see switch's default)

  switch (results.lib) {
    case "react-uic":
      results.versions = getVersions(pkgs, "@abgov/react-components", reactLatestMatcher)
      if (results.versions.length > 0)
        stats.reactUICLibCount += 1
      for (let el of elements) {
        // React uses TextArea
        if (el === "textarea") el = "text-area"
        const count = await getElementCount(`GoA${camelCase(el, { pascalCase: true })}`, "*.tsx", "*.jsx")
        results.elements[el] = count
        results.count += count
      }
      break
    case "angular-uic":
      results.versions = getVersions(pkgs, "@abgov/angular-components", angularLatestMatcher)
      if (results.versions.length > 0)
        stats.angularUICLibCount += 1
      for (const el of elements) {
        const count = await getElementCount(`goa-${el}`, "*.html")
        results.elements[el] = count
        results.count += count
      }
      break
    case "vue-uic":
      results.versions = getVersions(pkgs, "@abgov/web-components", vueLatestMatcher)
      if (results.versions.length > 0)
        stats.vueUICLibCount += 1
      for (const el of elements) {
        const count = await getElementCount(`goa-${el}`, "*.vue")
        results.elements[el] = count
        results.count += count
      }
      break
    case "wc-uic":
      results.versions = getVersions(pkgs, "@abgov/web-components")
      if (results.versions.length > 0)
        stats.wcUICLibCount += 1
      for (const el of elements) {
        const count = await getElementCount(`goa-${el}`, "*.html")
        results.elements[el] = count
        results.count += count
      }
      break
    case "react-uic-old":
      stats.reactUICLibCountOld += 1
      break
    case "angular-uic-old":
      stats.angularUICLibCountOld += 1
      break
    case "vue-uic-old":
      stats.vueUICLibCountOld += 1
      break
    case "react":
      stats.reactCount += 1
      break
    case "angular":
      stats.angularCount += 1
      break
    case "vue":
      stats.vueCount += 1
      break
    default:
      stats.totalLibCount -= 1 // I guess nothing was used :(
  }

  await exec('rm -rf tmp')

  return results
}

async function saveReportData(report: Report) {
  const t = new Date()
  const timestamp = t.toISOString()
  report.data.sort((a, b) => a.count < b.count ? 1 : -1)
  const output = JSON.stringify(report)
  await fs.writeFile(`report/data/${timestamp}.json`, output)
  console.log("report written")
}

// Content Helpers

function getLibType(pkgs: Package[]): LibType {
  if (usesLibrary(pkgs, "@abgov/react-components", reactLatestMatcher)) 
    return "react-uic"
  if (usesLibrary(pkgs, "@abgov/angular-components", angularLatestMatcher)) 
    return "angular-uic"
  if (usesLibrary(pkgs, "@abgov/web-components")  
    && usesLibrary(pkgs, "vue"))
    return "vue-uic"
  if (usesLibrary(pkgs, "@abgov/web-components"))
    return "wc-uic"
  if (usesLibrary(pkgs, "@abgov/react-components")) 
    return "react-uic-old"
  if (usesLibrary(pkgs, "@abgov/angular-components")) 
    return "angular-uic-old"
  if (usesLibrary(pkgs, "@abgov/vue-components"))
    return "vue-uic-old"
  if (usesLibrary(pkgs, "react")) 
    return "react"
  if (usesLibrary(pkgs, "angular/core")) 
    return "angular"
  if (usesLibrary(pkgs, "vue")) 
    return "vue"
  
  return "none"
}

/**
 * Finds the number of elements/components specified within the current lib
 */
async function getElementCount(text: string, ...fileFilter: string[]): Promise<number> {
  // TODO: allow for an exclude filter to be passed in
  const includes = fileFilter
    .map(filter => `--include "${filter}"`)
    .join(" ")
  const { stdout } = await exec(`grep ${includes} -r "<${text}[ >]" tmp | wc -l`)
  return parseInt(stdout)
}

/**
 * Gets all a list of versions of the specified library that are currently 
 * being used in the project
 */
function getVersions(pkgs: Package[], lib: string, matcher?: RegExp): string[] {
  const versions: string[] = []

  pkgs.forEach(pkg => {
    const libs = [
      ...Object.keys(pkg?.dependencies || {}), 
      ...Object.keys(pkg?.devDependencies || {})
    ]
    libs  
      .filter(l => l.startsWith(lib))
      .forEach(key => {
        const version = pkg.dependencies?.[key] || pkg.devDependencies?.[key]
        if (version && matcher && matcher.exec(version)) {
          versions.push(version)
        }
        if (version && !matcher) {
          versions.push(version)
        }
      })
  })
  
  return versions
}

function usesLibrary(pkgs: Package[], lib: string, matcher?: RegExp): boolean {
  const versions: string[] = getVersions(pkgs, lib, matcher)
  return versions.length > 0
}

/**
 * Gets a list of files within the specified path that match the passed in name
 */
async function getAllFilePaths(name: string): Promise<string[]> {
  const { stdout } = await exec(`find ./tmp -path ./node_modules -prune -o -name ${name} -print`)
  const paths = stdout.split("\n")
  return paths.filter(p => p.trim().length > 0)
}

/**
 * Finds all the package.json files within the current repo
 */
async function getAllPackages(): Promise<Package[]> {
  const pkgs: Package[] = []
  const paths = await getAllFilePaths("package.json")  
  for (const path of paths) {
    const p = await getPackage(path)
    if (p) {
      pkgs.push(p)
    }
  }
  return pkgs
}

/**
 * Gets the package details
 */
async function getPackage(filepath: string): Promise<Package | null> {
  try {
    const raw = await fs.readFile(filepath, "utf8")
    return JSON.parse(raw)
  } catch(e) {
    return null
  }
}