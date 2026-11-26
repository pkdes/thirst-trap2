# Deploying

Pushes to `main` (or a manual run of the **Deploy** workflow) lint, test, build and run
`firebase deploy` to project `thirst-trap-15acc`, authenticating via GitHub OIDC
(Workload Identity Federation). No long-lived keys are stored.

## One-time setup

```bash
PROJECT_ID=thirst-trap-15acc
PROJECT_NUMBER=<PROJECT_NUMBER>      # gcloud projects describe $PROJECT_ID --format='value(projectNumber)'
REPO=pkdes/thirst-trap2              # GITHUB_OWNER/REPO
SA=github-deployer
SA_EMAIL=$SA@$PROJECT_ID.iam.gserviceaccount.com

gcloud config set project $PROJECT_ID
```

### 1. Deploy service account and roles

```bash
gcloud iam service-accounts create $SA --display-name="GitHub Actions deployer"

for ROLE in \
  roles/firebasehosting.admin roles/cloudfunctions.developer roles/run.admin \
  roles/secretmanager.viewer roles/cloudscheduler.admin roles/artifactregistry.writer \
  roles/firebaserules.admin roles/datastore.indexAdmin \
  roles/serviceusage.serviceUsageConsumer roles/firebase.viewer; do
  gcloud projects add-iam-policy-binding $PROJECT_ID \
    --member="serviceAccount:$SA_EMAIL" --role=$ROLE --condition=None
done

# Act-as the functions runtime SA. v2 functions default to the compute SA.
gcloud iam service-accounts add-iam-policy-binding \
  $PROJECT_NUMBER-compute@developer.gserviceaccount.com \
  --member="serviceAccount:$SA_EMAIL" --role=roles/iam.serviceAccountUser
```

Extensions are not deployed, so `firebaseextensions.*` roles are skipped.

### 2. Workload identity pool and GitHub provider

```bash
gcloud iam workload-identity-pools create github --location=global --display-name="GitHub"

gcloud iam workload-identity-pools providers create-oidc github-actions \
  --location=global --workload-identity-pool=github \
  --issuer-uri="https://token.actions.githubusercontent.com" \
  --attribute-mapping="google.subject=assertion.sub,attribute.repository=assertion.repository,attribute.ref=assertion.ref" \
  --attribute-condition="assertion.repository == '$REPO' && assertion.ref == 'refs/heads/main'"
```

### 3. Let that identity impersonate the deployer

```bash
gcloud iam service-accounts add-iam-policy-binding $SA_EMAIL \
  --role=roles/iam.workloadIdentityUser \
  --member="principalSet://iam.googleapis.com/projects/$PROJECT_NUMBER/locations/global/workloadIdentityPools/github/attribute.repository/$REPO"
```

The provider condition already restricts to `main`, so `workflow_dispatch` only works when run on `main`.

### 4. GitHub repository variables

Settings > Secrets and variables > Actions > **Variables** (not secrets):

| Variable | Value |
|---|---|
| `VITE_FIREBASE_API_KEY`, `VITE_FIREBASE_AUTH_DOMAIN`, `VITE_FIREBASE_PROJECT_ID`, `VITE_FIREBASE_STORAGE_BUCKET`, `VITE_FIREBASE_MESSAGING_SENDER_ID`, `VITE_FIREBASE_APP_ID`, `VITE_FIREBASE_VAPID_KEY` | From Firebase console (see `.env.example`) |
| `GCP_WIF_PROVIDER` | `projects/<PROJECT_NUMBER>/locations/global/workloadIdentityPools/github/providers/github-actions` |
| `GCP_DEPLOY_SA` | `github-deployer@thirst-trap-15acc.iam.gserviceaccount.com` |

`VITE_*` values are inlined into the public client bundle by design; they are not secrets.
The Anthropic key lives in Secret Manager (`firebase functions:secrets:set ANTHROPIC_API_KEY`), never in GitHub.

## Manual first deploy (laptop)

```bash
cp .env.example .env   # fill in values
npm ci && npm ci --prefix functions
npm run build && npx firebase deploy
```

Do this once before CI so APIs, the functions secret and the first function revisions exist.

## Rollback

Firebase console > Hosting > release history > "..." on a previous release > Rollback.
Functions and rules have no one-click rollback: revert the commit on `main` and redeploy.

## Unverified, check on first CI run

- Role list is the requested set; the first functions deploy may report a missing permission
  (commonly `roles/cloudbuild.builds.editor`, or `roles/secretmanager.secretAccessor` when
  binding the secret to a function). Add what the error names.
- Required APIs (cloudbuild, cloudfunctions, run, artifactregistry, eventarc, cloudscheduler,
  firebaserules, firebasehosting) must be enabled; the manual deploy usually enables them.
- `firebase.json` has no `firestore.indexes` entry yet; add `firestore.indexes.json` before relying on index deploys.
- `npm run test:unit` must exist in `package.json` or the workflow fails.
