// Sync the directories for non-content dirs ONLY
// that way, we can clean up stuff left behind without pain
import util from 'util'
import AWS from 'aws-sdk'
import waterfall from 'async/waterfall'
import {spawn} from 'child_process'
import fs from 'fs'
import request from 'request'
import extract from 'extract-zip'
import s3 from 's3'
import uuidV4 from 'uuid/v4';

const dstBucket = 'bpho-src';

const tmpDir = `/tmp/${uuidV4()}`;

const syncClient = s3.createClient({
    maxAsyncS3: 20,
});

function handleDeploy(message, dstBucket, context) {
  const repo = message.repository;
  const zipLocation = `${tmpDir}/master.zip`;
  const unzippedLocation = `${tmpDir}/${repo.name}-master`;

  waterfall([
    function mkTempDir(next) {
      const child = spawn('mkdir', ['-p', tmpDir], {});
      child.on('error', (err) => {
        console.log('Failed to create directory: %s', err);
        next(err);
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
        .on('error', function(err) {
            console.error('Request failed with error: ' + err);
            next(err);
        })
        .on('close', function () {
          console.log('Finished downloading %s', zipUrl);
          next(null);
        });
    },
    function unzipRepo(next) {
      console.log('Unzipping %s to %s', zipLocation, unzippedLocation);
      extract(zipLocation, { dir: tmpDir }, (err) => {
        if (err) {
          console.error('Unzip failed with error: ' + err);
          next(err);
          return;
        }
        console.log('Finished unzipping');
        next(null);
      });

    },
    function upload(next) {
      console.log('Syncing %s to bucket %s', unzippedLocation, dstBucket);
      const uploader = syncClient.uploadDir({
        localDir: unzippedLocation,
        deleteRemoved: true,
        s3Params: {
          ACL: 'private',
          Bucket: dstBucket,
          CacheControl: 'max-age=60',
        },
      });

      uploader.on('fileUploadEnd', (localFilePath) => console.info('Uploaded %s', localFilePath));

      uploader.on('error', (err) => {
        console.error('Sync failed with error: ', err.stack);
        next(err);
      });

      uploader.on('end', () => {
        console.log('Finished syncing to S3');
        next(null);
      });
    },
    function publishToSNS(next) {
      console.log('Triggering rebuild via SNS');
      const sns = new AWS.SNS({
        region: 'eu-west-1',
      });

      sns.publish({
        Message: 'Site updated from GitHub, start the rebuild!',
        TopicArn: 'arn:aws:sns:eu-west-1:420685058923:BPhORebuildSite'
      }, (err, data) => {
        if (err) {
          console.error(err.stack);
          next(err);
          return;
        }
        console.log('SNS rebuild notification published');
      });
    }
  ], function(error) {
      if (error) {
        console.error('Deploy failed due to: ' + error);
      } else {
        console.log('All methods in waterfall succeeded.');
      }

      context.done();
  });
}

exports.handler = function(event, context) {
  const message = (typeof event === 'string')
    ? JSON.parse(event.Records[0].Sns.Message)
    : event.Records[0].Sns.Message;
  console.log('Reading options from event:\n', util.inspect(message, {depth: 5}));

  handleDeploy(message, dstBucket, context);
};
