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
      artifactPath: core.getInput('artifact-path'),
      token: core.getInput('token'),
      app: core.getInput('app')
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

    await axios.post(`https://api.heroku.com/apps/${args.app}/builds`, { source_blob: { url: source_blob.get_url } }, herokuConfig);
    console.log('Success!'.green);

  } catch (error) {
    core.setFailed(error.message);
  }
}

run();
