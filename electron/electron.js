const { app, BrowserWindow, ipcMain } = require("electron");
const path = require("path");
// const { electron } = require("process");
const url = require("url");
// This makes the CLI commands asynchronous
const util = require('util');
const exec = util.promisify(require('child_process').exec);
const { config } = require("dotenv");
const fs = require('fs');
const readline = require('readline');
const k8Config = require('@kubernetes/client-node/dist/config');
let win;

/**
 * @return Return the name of the Cluster declared in .kube/config
 * Otherwise return empty
 */
async function getConfigClusterName() {

  try {

    console.log('gettingConfigClusterName...', __dirname)
    const home = k8Config.findHomeDir();

    // Leverage K8's functions to find the config file

    const absolutePath = path.join(home, '.kube/config');

    // console.log('absolute Path:', absolutePath);
    const fileStream = fs.createReadStream(absolutePath);

    const rl = readline.createInterface({
      input: fileStream,
      crlfDelay: Infinity
    });

    // Read the file line by line
    for await (const line of rl) {
      console.log(`Line from file: ${line}`);
      if(line.includes('current-context:')) {
        // Return name of cluster
        return line.split('/')[1];
      }
    }
  } catch (e) {
    console.log('error!', e);
    return '';
  }
}

/**
 * 
 * @remarks
 * This method executes a aws CLI command to retrieve the specified field
 * @param field The field to retrieve
 * @returns a string
 */
async function setAWSField(field, value) {
  try {
    const { stdout, stderr } = await exec(`aws configure set ${field} ${value}`);
    // Should be empty
    return stdout;
  } catch (e) {
    return e;
  }
}

/**
 * 
 * @remarks
 * This method executes a aws CLI command to retrieve the specified field
 * @param field The field to retrieve
 * @returns a string
 */
async function getAWSField(field) {
  try {
    const { stdout, stderr } = await exec(`aws configure get ${field}`);
    console.log('exec:', stdout);
    // Strip '\n' from the end of the response string
    return stdout.slice(0, stdout.length - 1);
  } catch (e) {
    console.log('err:', e);
    return '';
  }
}

function createWindow() {
  // Create the browser window
  // Sets the dimensions and contextBridge between main and renderer processes
  win = new BrowserWindow({
    width: 1400, height: 900,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js')
    }
  });
  // In production, set the initial browser path to the local bundle generated
  // by the Create React App build process.
  // In development, set it to localhost to allow live/hot-reloading.
  console.log('NODE_ENV:', process.env.NODE_ENV);
  const appURL = (process.env.NODE_ENV === "production")
    ? url.format({
      pathname: path.join(__dirname, "../dist/index.html"),
      protocol: "file:",
      slashes: true,
    })
    : "http://localhost:8080";
  console.log('appURL:', appURL);
  win.loadURL(appURL);


  // Automatically open Chrome's DevTools in development mode.
  if (!app.isPackaged) {
    win.webContents.openDevTools();
  }
}

/**
 * 
 * @param {*} region 
 * @param {*} myCluster 
 * @returns True if created successfully, otherwise false
 */
async function updateKubeConfig(region, myCluster) {
  console.log("updating kube config!");
  try {
    const { stdout, stderr } = await exec(`aws eks update-kubeconfig --region ${region} --name ${myCluster}`);

    if (stdout.includes('Could not connect')) {
      return false;
    }
    return true;
  } catch (e) {
    return false;
  }
}

app.whenReady().then(() => {
  /**
     * @remarks
     * Invoked by Login.tsx when the Login button is pressed
     * Configures the client's auth using CLI commands 
     * @param event - event that triggered the 
     * @param arg - how to configure the client's local files
     * @returns True if success, otherwise False
     */
  ipcMain.on('on-config', async (event, arg) => {
    console.log('arg', arg);

    let kubeconfigResp = false;

    const keyResp = await setAWSField('aws_access_key_id', arg[0])
    const secretResp = await setAWSField('aws_secret_access_key', arg[1])
    const regionResp = await setAWSField('region', arg[3])
    const outputResp = await setAWSField('output', 'json')
    console.log('on-config!');

    // If no bad responses, then set the Kube Config file
    if (!keyResp && !secretResp && !regionResp && !outputResp) {
      kubeconfigResp = await updateKubeConfig(arg[3], arg[2]);
    }

    // Trigger another IPC event back to the render process
    // Sending individual results in case we want input-specific error messages
    event.sender.send('onConfigResp', [keyResp, secretResp, regionResp, outputResp, kubeconfigResp]);
  });

  /**
   * @remarks
   * Invoked by Login.tsx when the Login button is pressed
   * Configures the client's auth using CLI commands 
   * @param event - event that triggered the 
   * @returns True if success, otherwise False
   */
  ipcMain.on('get-config', async (event) => {
    console.log("get-config");
    // Retrieve the user's Access Key, Secret Key, and Region from their local files
    const access_key = await getAWSField('aws_access_key_id');
    const secret_key = await getAWSField('aws_secret_access_key');
    const region = await getAWSField('region');
    const cluster_name = await getConfigClusterName();

    const data = [access_key, secret_key, cluster_name, region];
    console.log('sending config:', data);

    // Send the information to Login.tsx
    event.sender.send('onSendConfig', data);
  });

  createWindow();
});