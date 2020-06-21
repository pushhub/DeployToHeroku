const core = require('@actions/core');
const github = require('@actions/github');

try {
    const artifactPath = core.getInput('artifact-path');
    console.log(`Using artifact: ${artifactPath}`);
} catch (error) {
    core.setFailed(error.message);
}
