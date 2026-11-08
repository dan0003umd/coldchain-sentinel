// =====================================================================
// auth.js — sign-in with Rashmitha's Cognito user pool (see docs/auth.md).
// Uses the amazon-cognito-identity-js library (SRP sign-in, no hosted page).
// The library keeps the session in the browser, so a refresh stays signed in.
// =====================================================================

function userPool() {
  return new AmazonCognitoIdentity.CognitoUserPool({ UserPoolId: USER_POOL_ID, ClientId: CLIENT_ID });
}

// sign in with email + password -> resolves with the reviewer's email
function signIn(email, password) {
  return new Promise((resolve, reject) => {
    const user = new AmazonCognitoIdentity.CognitoUser({ Username: email, Pool: userPool() });
    const details = new AmazonCognitoIdentity.AuthenticationDetails({ Username: email, Password: password });
    user.authenticateUser(details, {
      onSuccess: () => resolve(email),
      onFailure: (err) => reject(new Error(err.message || "Sign-in failed")),
      // accounts made without a permanent password land here
      newPasswordRequired: () =>
        reject(new Error("This account still has a temporary password. Ask Rashmitha to set a permanent one.")),
    });
  });
}

// the current session, or null if nobody is signed in (refreshes expired tokens automatically)
function currentSession() {
  return new Promise((resolve) => {
    const user = userPool().getCurrentUser();
    if (!user) return resolve(null);
    user.getSession((err, session) => resolve(err || !session || !session.isValid() ? null : session));
  });
}

// the ID token the API expects in the Authorization header
async function getIdToken() {
  const session = await currentSession();
  if (!session) throw new Error("Please sign in.");
  return session.getIdToken().getJwtToken();
}

// the signed-in reviewer's email (shown in the top bar)
async function currentEmail() {
  const session = await currentSession();
  return session ? session.getIdToken().payload.email : null;
}

function signOut() {
  const user = userPool().getCurrentUser();
  if (user) user.signOut();
  showLogin();
}
