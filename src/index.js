import series from 'async/series'
import AWS from 'aws-sdk'
import { spawn } from 'child_process'
import extract from 'extract-zip'
import fs from 'fs'
import yaml from 'js-yaml';
import request from 'request'
import s3 from 's3'
import util from 'util'
import uuidV4 from 'uuid/v4';

const createErrorHandler = (callback) => (message, errorObj = false) => {
  console.error(message);
  if (errorObject) {
    console.log(util.inspect(errorObject, { depth: 5 }));
  }
  callback(message);
};

exports.handler = function(event, context, callback) {
  const errorHandler = createErrorHandler(callback);
  const rawMessage = event.Records[0].Sns.Message;
  const message = (typeof rawMessage === 'string')
    ? JSON.parse(rawMessage)
    : rawMessage;
  console.log('Reading options from event:\n', util.inspect(message, { depth: 5 }));
  
  let params = {
    repo: message.repository,
  };

  // Check we're on the master branch for the repo by matching the last bit of 
  // ref/heads/BRANCH_NAME against the repo master_branch name
  if (message.ref.substr(message.ref.lastIndexOf('/') + 1) !== params.repo.master_branch) {
    errorHandler('Lambda should only run on changes to the master branch');
  }

  // Attempt to load the config file for this repo from the specified config bucket
  const [configUrl, configBucket, configFolder] = process.env.CONFIG_FOLDER.match(/^s3:\/\/([^\/]+)\/(.*)/);
  console.log('Attempting to load config for %s from %s', params.repo.name, `${configUrl}${params.repo.name}.yaml`);
  new AWS.S3().getObject({ 
    Bucket: configBucket, 
    Key: `${configFolder}${params.repo.name}.yaml`,
  }, (err, data) => {
    if (err) {
      errorHandler('Error finding config for this repo', err);
    } else {
      console.log('Config loaded');
      params = Object.assign(params, yaml.safeLoad(data.Body.toString()));
      handleCloneRepoToS3(params, callback, errorHandler);
    }
  });
}

// Main 
const handleCloneRepoToS3 = (params, callback, errorHandler) => {
  const { destBucket, repo, snsTopicArn, snsTopicRegion } = params;
  const tmpDir = '/tmp/' + uuidV4();
  const zipLocation = `${tmpDir}/master.zip`;
  const unzippedLocation = `${tmpDir}/${repo.name}-master`;

  series([
    function makeTempDir(next) {
      spawn('mkdir', ['-p', tmpDir], {})
        .on('error', (err) => next({ 
          message: 'Error creating temp directory', 
          errorObj: err 
        }))
        .on('close', () => {
          console.log('Created directory: %s', tmpDir);
          next();
        });
    },
    function getZippedRepo(next) {
      console.log('Fetching repo %s', repo.name);
      const zipUrl = `${repo.html_url}/archive/master.zip`;
      request(zipUrl)
        .pipe(fs.createWriteStream(zipLocation))
        .on('error', (err) => next({ 
          message: 'Error unzipping repo', 
          errorObj: err,
        }))
        .on('close', () => {
          console.log('Finished downloading %s', zipUrl);
          next(null);
        });
    },
    function unzipRepo(next) {
      console.log('Unzipping %s to %s', zipLocation, unzippedLocation);
      extract(zipLocation, { dir: tmpDir }, (err) => {
        if (err) {
          next({ 
            message: 'Error unzipping repo', 
            errorObj: err,
          });
        } else {
          console.log('Finished unzipping');
          next();
        }
      });
    },
    function upload(next) {
      console.log('Syncing %s to bucket %s', unzippedLocation, destBucket);
      const syncClient = s3.createClient({ maxAsyncS3: 20 });
      const uploader = syncClient.uploadDir({
        localDir: unzippedLocation,
        deleteRemoved: true,
        s3Params: {
          ACL: 'private',
          Bucket: destBucket,
        },
      });

      uploader.on('fileUploadEnd', (localFilePath) => 
        console.info('Uploaded %s', localFilePath));

      uploader.on('error', (err) => {
        next({ 
          message: 'Error syncing to S3', 
          errorObj: err,
        });
      });

      uploader.on('end', () => {
        console.log('Finished syncing to S3');
        next();
      });
    },
    function deleteTempDir(next) {
      spawn('rm', ['-rf', tmpDir], {})
        .on('error', (error) => next({ 
          message: 'Error deleting temp directory', 
          errorObj: err,
        }))
        .on('close', () => {
          console.log('Deleted directory: %s', tmpDir);
          next();
        });
    },
    function publishToSNS(next) {
      if (!snsTopicArn) {
        console.log('No SNS config set, skipping publish');
        return next();
      }

      console.log('Publishing notification to SNS');
      console.log('Using topic ARN %s', snsTopicArn);
      
      const snsClient = new AWS.SNS({ region: snsTopicRegion });
      snsClient.publish({
        Message: JSON.stringify({
          'event': 'gitHubUpdate',
          'project': repo.name,
        }),
        TopicArn: snsTopicArn,
      }, (err, data) => {
        if (err) {
          next({ 
            message: 'Error publishing to SNS', 
            errorObj: err,
          });
        } else {
          console.log('SNS rebuild notification published');
          next();
        }
      });
    },
  ], ({ message, errorObj }) => {
    if (message) {
      errorHandler(message, errorObj);
    } else {
      callback(null, 'Clone repo to S3 successfully completed');
    }
  });
};
