import fs from "fs/promises"

// Generate the html output that contains a chart and all the report
// data on file
export async function generateReport() {
  
  const files = await fs.readdir("./data")

  const reports: {date: string, data: any}[] = []
  for (const filename of files) {
    const data = await fs.readFile(`./data/${filename}`, "utf8")
    reports.push({ date: filename.replace(".json", ""), data: JSON.parse(data) }) 
  }
  
  // embed the json data into the html page
  const template = await fs.readFile("./report/index.html.template", "utf8")
  const html = template.replace("{DATA}", JSON.stringify(reports))
  await fs.writeFile("./report/index.html", html)
}
