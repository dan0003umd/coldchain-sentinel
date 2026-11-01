# Reviewer login (Cognito)

Only signed-in reviewers can use the dashboard and the reviewer API. Login is defined in `template.yaml`, so it deploys with the rest of the stack.

## What gets created

| Resource | Purpose |
| --- | --- |
| `ReviewerUserPool` | List of allowed users. Admin-created accounts only, email sign-in, 12-character minimum password |
| `ReviewerUserPoolClient` | App client for the dashboard. No client secret, SRP sign-in, 1-hour ID and access tokens, 1-day refresh token |
| `ReviewerGroup` | Group named `reviewers` |

Stack outputs: `ReviewerUserPoolId`, `ReviewerUserPoolArn`, `ReviewerUserPoolClientId`.

## Deploy

```
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

aws cognito-idp admin-create-user --user-pool-id $POOL_ID --username $EMAIL --message-action SUPPRESS --region us-east-1
aws cognito-idp admin-set-user-password --user-pool-id $POOL_ID --username $EMAIL --password "$PASS" --permanent --region us-east-1
aws cognito-idp admin-add-user-to-group --user-pool-id $POOL_ID --username $EMAIL --group-name reviewers --region us-east-1
```

## Test sign-in

```
aws cognito-idp initiate-auth --auth-flow USER_PASSWORD_AUTH --client-id $CLIENT_ID --auth-parameters USERNAME=$EMAIL,PASSWORD="$PASS" --region us-east-1
```

Expected: an `AuthenticationResult` containing an `IdToken`. A wrong password returns `NotAuthorizedException`.

`ALLOW_USER_PASSWORD_AUTH` is enabled on the app client only for this CLI test. Remove it from `template.yaml` before the final demo. The dashboard uses SRP sign-in.

## Hand-off to the API

Point the API authorizer at the user pool:

```
Auth:
  DefaultAuthorizer: CognitoAuthorizer
  Authorizers:
    CognitoAuthorizer:
      UserPoolArn: !GetAtt ReviewerUserPool.Arn
```

The dashboard sends the ID token in the `Authorization` header. Calls without a valid token get 401. Lambdas can read the reviewer's email from `event.requestContext.authorizer.claims.email` to record who added a note or overrode an action.

## Hand-off to the dashboard

Sign in with the `amazon-cognito-identity-js` library (SRP flow) using the pool ID and client ID. No hosted-UI domain or callback URL is needed.

## Clean up

`sam delete --stack-name coldchain-sentinel --region us-east-1` removes the user pool with everything else.
