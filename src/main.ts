import * as core from "@actions/core";
import * as github from "@actions/github";
import axios from "axios";
import fs from 'fs';
import 'colors';

interface SourceBlobResponse {
  get_url: string;
  put_url: string;
}

interface Arguments {
  artifactPath: string;
  token: string;
  app: string;
}

interface EnvironmentMatcher {
  regex: RegExp;
  app: string;
}

function parseEnvironments(str: string): EnvironmentMatcher[] {
  let errorCount = 0;

  const l: EnvironmentMatcher[] = [];
  const environments: string[] = str.split('\n').filter(x => x != ''); 

  for (const line of environments) {
    const parts = line.split('->');
    if (parts.length != 2) {
      errorCount += 1;
      console.log(`${'invalid syntax:'.red} line contains too many arrow (\`->\`) separators.`);
      continue;
    }
    const lhs = parts[0].trim();
    const rhs = parts[1].trim();

    if (!(lhs.startsWith('/') && lhs.endsWith('/'))) {
      errorCount += 1;
      console.log(`${'invalid syntax:'.red} regex does not start and end with a forward slash (\`/\`).`)
      continue;
    }

    if (rhs.lastIndexOf(' ') !== -1) {
      errorCount += 1;
      console.log(`${'invalid syntax:'.red} app name cannot contain a space`);
      continue;
    }

    const regexStr = lhs.slice(1, lhs.length - 1);
    try {
      const regex = new RegExp(regexStr);
      l.push({ regex: regex, app: rhs });
    } catch (error) {
      console.log(`${'error:'.red} ${error.message}`);
      errorCount += 1;
      continue;
    }
  }

  if (errorCount > 0) {
    process.exit(-2);
  }

  return l;
}

function determineAppName(str: string): string {
  const branch = github.context.ref;
  const environments = parseEnvironments(str);
  for (const m of environments) {
    console.log(m.regex);
    if (branch.match(m.regex)) {
      return m.app;
    }
  }
  console.log(`${'warning:'.yellow} ${branch} was not matched against any apps. Did not trigger a deployment.`);
  process.exit(0);
}

function readArgument(label: string): string | null {
  for (const value of process.argv) {
    const parts = value.split("=");
    if (parts.length == 2) {
      if (parts[0] == label) {
        return parts[1];
      }
    }
  }
  return null;
}

function aquireArguments(): Arguments {
  if (process.argv.length != 4) {
    // Assume we are running on Github.
    return {
      artifactPath: core.getInput('artifact'),
      token: core.getInput('token'),
      app: determineAppName(core.getInput('environments'))
    };
  }

  const app = readArgument("--app");
  const artifactPath = readArgument("--artifact");
  const token = process.env.HEROKU_API_TOKEN;
  if (app == null || artifactPath == null) {
    console.error('error: not enough arguments provided.');
    console.warn('usage: nodejs lib/main.js --app=<your app> --artifact=<path>')
    process.exit(-1);
  } else if (token == null) {
    console.error('error: HEROKU_API_TOKEN not set in the environment.');
    process.exit(-1);
  }
  return {
    app: app,
    artifactPath: artifactPath,
    token: token
  };
}

async function run(): Promise<void> {
  try {
    const args = aquireArguments();
  
    console.log(`Starting deployment for app '${args.app.blue}' using artifact '${args.artifactPath.magenta}'`);

    const herokuConfig = {
      headers: {
        "Accept": "application/vnd.heroku+json; version=3",
        "Authorization": `Bearer ${args.token}`
      }
    };

    const blobResponse = await axios.post(`https://api.heroku.com/apps/${args.app}/sources`, null, herokuConfig);
    const source_blob: SourceBlobResponse = blobResponse.data.source_blob;

    const artifactData = fs.readFileSync(args.artifactPath);
    await axios.put(source_blob.put_url, artifactData, {headers: { 'Content-Type': '' }});
    console.log('Artifact uploaded.'.cyan);

    const buildData = {
      source_blob: { 
        url: source_blob.get_url,
        version: `${github.context.ref} (${github.context.sha}) triggered by ${github.context.actor}`
      }
    }
    console.log(`version: ${buildData.source_blob.version.magenta}`);
    await axios.post(`https://api.heroku.com/apps/${args.app}/builds`, buildData, herokuConfig);
    console.log('Success!'.green);

  } catch (error) {
    core.setFailed(error.message);
  }
}

run();
