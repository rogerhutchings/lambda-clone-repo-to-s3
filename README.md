# lambda-clone-repo-to-s3

Like it says on the tin - clones a GitHub repo down to an S3 bucket. It uses the GitHub AWS SNS integration to kick off a new clone on any change to the repo's master branch, and optionally triggers an SNS notification on completion.

## Configuration

### Local

This project uses [node-lambda](https://github.com/motdotla/node-lambda) to provide event testing and deployment to AWS, which uses an `.env` file to store AWS publishing details.

### Lambda

The lambda offers the following configuration options, which can be defined in the `deploy.env` file:

- `DEST_BUCKET` - sets the target bucket for the repo to be cloned to, e.g. `bucket-name`
- `SNS_TOPIC_ARN` - (optional) sets the topic that an SNS notification will be published to
- `SNS_TOPIC_REGION` - (optional) the region for the `SNS_TOPIC_ARN`

Note that the lambda ARN will also need access to the S3 destination bucket.

## Running

Use `npm run <command>` to interact with the project:

### `start`

Compiles and runs the project locally, passing in the contents of `event.json` as the event.

### `deploy`

Compiles, zips and publishes the lambda to AWS using the settings in `.env`

### `package`

Compiles and zips the lambda to the `/package` directory.
