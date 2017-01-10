import waterfall from 'async/waterfall'
import AWS from 'aws-sdk'
import { spawn } from 'child_process'
import extract from 'extract-zip'
import fs from 'fs'
import request from 'request'
import s3 from 's3'
import util from 'util'
import uuidV4 from 'uuid/v4';

exports.handler = function(event, context) {
  if (!process.env.DEST_BUCKET) {
    console.error('Destination bucket must be set by the DEST_BUCKET env variable');
    console.error('Exiting...')
    context.done();
  }

  const messageFromSns = event.Records[0].Sns.Message;
  console.log('Reading options from event:\n', util.inspect(messageFromSns, { depth: 5 }));
  const data = (typeof messageFromSns === 'string')
    ? JSON.parse(messageFromSns)
    : messageFromSns;
  
  const params = {
    destBucket: process.env.DEST_BUCKET,
    message: messageFromSns,
    snsTopicArn: process.env.SNS_TOPIC_ARN,
    snsTopicRegion: process.env.SNS_TOPIC_REGION,
    tmpDir: '/tmp/' + uuidV4(),
  };

  handleCloneRepoToS3(params, context);
}

// Main 
const handleCloneRepoToS3 = (params, context) => {
  const { destBucket, snsTopicArn, snsTopicRegion, tmpDir } = params;
  const repo = params.message.repository;
  const zipLocation = `${tmpDir}/master.zip`;
  const unzippedLocation = `${tmpDir}/${repo.name}-master`;

  waterfall([
    function makeTempDir(next) {
      const child = spawn('mkdir', ['-p', tmpDir], {});
      child.on('error', (error) => {
        console.log('Failed to create directory: %s', error);
        next(error);
      });
      child.on('close', (code) => {
        console.log('Created directory: %s, %s', tmpDir, code);
        next(null);
      });
    },
    function getZippedRepo(next) {
      console.log('Fetching repo %s', repo.name);
      const zipUrl = `${repo.html_url}/archive/master.zip`;
      request(zipUrl)
        .pipe(fs.createWriteStream(zipLocation))
        .on('error', function(error) {
            console.error('Error downloading repo zip: %s', error);
            next(error);
        })
        .on('close', function () {
          console.log('Finished downloading %s', zipUrl);
          next(null);
        });
    },
    function unzipRepo(next) {
      console.log('Unzipping %s to %s', zipLocation, unzippedLocation);
      extract(zipLocation, { dir: tmpDir }, (error) => {
        if (error) {
          console.error('Error unzipping repo: %s', error);
          next(error);
        }
        console.log('Finished unzipping');
        next(null);
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

      uploader.on('fileUploadEnd', (localFilePath) => {
        console.info('Uploaded %s', localFilePath);
      });

      uploader.on('error', (error) => {
        console.error('Error syncing to S3: ', error.stack);
        next(error);
      });

      uploader.on('end', () => {
        console.log('Finished syncing to S3');
        next(null);
      });
    },
    function deleteTempDir(next) {
      const child = spawn('rm', ['-rf', tmpDir], {});
      child.on('error', (error) => {
        console.log('Error deleting directory: %s', error);
        next(error);
      });
      child.on('close', (code) => {
        console.log('Deleted directory: %s, %s', tmpDir, code);
        next(null);
      });
    },
    function publishToSNS(next) {
      if (!snsTopicArn) {
        console.log('No SNS config set, skipping publish');
        next(null);
      }

      console.log('Publishing notification to SNS');
      console.log('Using topic ARN %s', snsTopicArn);
      
      const snsClient = new AWS.SNS({ region: snsTopicRegion });
      snsClient.publish({
        Message: 'Site updated from GitHub, start the rebuild!',
        TopicArn: snsTopicArn,
      }, (error, data) => {
        if (error) {
          console.error(error.stack);
          next(error);
        }
        console.log('SNS rebuild notification published');
        next(null);
      });
    },
  ], function(error) {
      if (error) {
        console.error('Error running clone repo to S3: %s', error);
      } else {
        console.log('Clone repo to S3 successfully completed');
      }

      context.done();
  });
};
