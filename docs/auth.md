# Reviewer login (Cognito)

## Scope of this change

This change creates the **authentication infrastructure only**: a Cognito user pool, an app client and a `reviewers` group, defined in `template.yaml` and deployed with the rest of the stack.

It does **not** include, and these are separate follow-ups:

- **Dashboard and reviewer API integration.** No API or dashboard is added here. The API owner attaches the authorizer (see "Hand-off to the API") and the dashboard owner builds the sign-in page.
- **Reviewers-group enforcement.** Creating the `reviewers` group does not restrict anything by itself. A Cognito authorizer only checks that a token is valid, so any user in the pool is accepted. Limiting an action to the `reviewers` group needs a check of the `cognito:groups` claim in the API Lambdas. That check belongs with the API work.

## What gets created

| Resource | Purpose |
| --- | --- |
| `ReviewerUserPool` | List of allowed users. Admin-created accounts only (no self sign-up), email sign-in, 12-character minimum password |
| `ReviewerUserPoolClient` | App client for the dashboard. No client secret, SRP sign-in, 1-hour ID and access tokens, 1-day refresh token |
| `ReviewerGroup` | Group named `reviewers` |

Stack outputs: `ReviewerUserPoolId`, `ReviewerUserPoolArn`, `ReviewerUserPoolClientId`.

## Email verification and password recovery

- The pool sets `AutoVerifiedAttributes: email` and `AccountRecoverySetting` to `verified_email` (priority 1). Cognito therefore recovers passwords by sending a code to the user's **verified** email address.
- Accounts created by an administrator are not verified automatically. Create each reviewer with `email_verified=true` (see "Create a reviewer"). Without it, password recovery is unavailable for that user.
- The pool uses Cognito's default email sender, which has a low daily sending limit. That is enough for a prototype.
- Status: this is **configured but not tested end to end**. The forgot-password flow was not exercised, and the dashboard would have to provide a forgot-password page to use it.

## Deploy

```
sam validate --lint
sam build
sam deploy
```

Read the outputs:

```
aws cloudformation describe-stacks --stack-name coldchain-sentinel --region us-east-1 --query "Stacks[0].Outputs" --output table
```

## Create a reviewer

Replace the placeholders. Do not commit passwords. The password needs 12+ characters with a lowercase letter, an uppercase letter and a number.

```
POOL_ID=<ReviewerUserPoolId>
CLIENT_ID=<ReviewerUserPoolClientId>
EMAIL=reviewer1@example.com
PASS='<choose a password>'

aws cognito-idp admin-create-user --user-pool-id $POOL_ID --username $EMAIL --user-attributes Name=email,Value=$EMAIL Name=email_verified,Value=true --message-action SUPPRESS --region us-east-1
aws cognito-idp admin-set-user-password --user-pool-id $POOL_ID --username $EMAIL --password "$PASS" --permanent --region us-east-1
aws cognito-idp admin-add-user-to-group --user-pool-id $POOL_ID --username $EMAIL --group-name reviewers --region us-east-1
```

Check the email is verified and the group membership (neither command prints the email or a password):

```
aws cognito-idp admin-get-user --user-pool-id $POOL_ID --username $EMAIL --region us-east-1 --query "UserAttributes[?Name=='email_verified'].Value" --output text
aws cognito-idp admin-list-groups-for-user --user-pool-id $POOL_ID --username $EMAIL --region us-east-1 --query "Groups[].GroupName" --output text
```

Expected: `true` and `reviewers`.

## Test sign-in

```
aws cognito-idp initiate-auth --auth-flow USER_PASSWORD_AUTH --client-id $CLIENT_ID --auth-parameters USERNAME=$EMAIL,PASSWORD="$PASS" --region us-east-1
```

Expected: an `AuthenticationResult` containing tokens. A wrong password returns `NotAuthorizedException`.

`ALLOW_USER_PASSWORD_AUTH` is enabled on the app client only for this CLI test. Remove it from `template.yaml` before the final demo. The dashboard uses SRP sign-in.

## Verification results

Run in a separate AWS account (us-east-1) with a test reviewer. No passwords or tokens are recorded here.

| Check | Result |
| --- | --- |
| `sam validate --lint` | `template.yaml is a valid SAM Template` |
| `sam build` | Build succeeded |
| `sam deploy` | Stack created, including the user pool, app client and group |
| Sign-in with correct password | Returned an access token, ID token and refresh token |
| Group membership | The ID token's `cognito:groups` claim contained `reviewers` |
| Sign-in with wrong password | Rejected with `NotAuthorizedException: Incorrect username or password` |
| Password recovery by email | Not tested |
| Calls to an API without and with a token | Not tested (no API in this change) |

## Hand-off to the API

**The example below is for a REST API (`AWS::Serverless::Api`) only.** An HTTP API (`AWS::Serverless::HttpApi`) uses a different JWT authorizer configuration and a different claims path, so do not copy this snippet into one.

```
Auth:
  DefaultAuthorizer: CognitoAuthorizer
  Authorizers:
    CognitoAuthorizer:
      UserPoolArn: !GetAtt ReviewerUserPool.Arn
```

With a REST API and this authorizer:

- The dashboard sends the **ID token** in the `Authorization` header. Calls without a valid token get 401.
- Lambdas can read the reviewer's email from `event.requestContext.authorizer.claims.email` to record who added a note or overrode an action.
- The `cognito:groups` claim is in the same `claims` object. It may arrive as a string rather than a list, so parse it carefully when enforcing the `reviewers` group.

## Hand-off to the dashboard

Sign in with the `amazon-cognito-identity-js` library (SRP flow) using the pool ID and client ID. No hosted-UI domain or callback URL is needed.

## Clean up

**Warning: this deletes the entire `coldchain-sentinel` stack, not only the login resources.** It removes every table and its data, all Lambda functions, the Step Functions workflow, the IoT rule, and the user pool with **all reviewer accounts**. Only run it when you are finished with the whole project in that AWS account.

```
sam delete --stack-name coldchain-sentinel --region us-east-1
```

To remove only the login, delete the three Cognito resources and the three outputs from `template.yaml` and run `sam deploy` again.
