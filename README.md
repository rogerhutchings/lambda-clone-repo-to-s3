# lambda-clone-repo-to-s3

Like it says on the tin - clones a GitHub repo down to an S3 bucket. It uses the GitHub AWS SNS integration to kick off a new clone on any change to the repo's master branch, and optionally triggers an SNS notification on completion.

## Configuration

### Local

This project uses [node-lambda](https://github.com/motdotla/node-lambda) to provide event testing and deployment to AWS, which uses an `.env` file to store AWS publishing config.

### Lambda

In order to keep configuration separate from code, and allow the lambda to be used with multiple repos, configuration for each repo is kept in an external YAML file on S3, named after the repo it corresponds to. 

To set the location where the lambda should look for its configs, you'll need to set the `CONFIG_FOLDER` environment variable, which node-lambda enables in `deploy.env`:

```ini
CONFIG_FOLDER=s3://config-bucket/folder/
```

Each `<repo>.yaml` file which can contain the following settings:

- `destBucket` - sets the target bucket for the repo to be cloned to, e.g. `bucket-name`
- `snsTopicArn` - (optional) sets the topic that an SNS notification will be published to
- `snsTopicRegion` - (optional) the region for the `snsTopicArn`

Note that the lambda ARN will need access to the S3 config and destination bucket.

## Running

Use `npm run <command>` to interact with the project:

### `setup`

Generates a set of default config files.

### `start`

Compiles and runs the project locally, passing in the contents of `event.json` as the event.

### `deploy`

Compiles, zips and publishes the lambda to AWS using the settings in `.env`

### `package`

Compiles and zips the lambda to the `/package` directory.
