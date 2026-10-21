# Approved pilot deployment: verified infrastructure blocker

> Superseded on 21 October 2026: the owner requires Spark with no payment or billing upgrade. Do not execute the Cloud Run provisioning/deployment instructions below. They remain historical evidence only. Follow FINANCE_V2_SPARK_CONSTRAINT.md. Cloud Run requires billing and is outside the authorised scope.

Owner approved the next deployment step. A read-only authenticated check ran successfully in GitHub Actions run 39562006225, commit 97defc82a882ef2cadcf0b52b1dba2f0a495eeed. No further owner approval for that same deployment step is being requested; actual cloud access and runtime provisioning are missing.

Confirmed:

- Firebase project: gen-lang-client-0911422817.
- Named Firestore database: ai-studio-f7d8654b-e089-425a-a506-38159afe1e75.
- Database metadata and tenant/branch reads succeeded using the existing CI service identity.
- Database location: europe-west1.
- Martin Pharma (`mp`) and Masaka were resolved and active.
- Trusted transfers, account registration, trusted EOD and POS cash funding are all disabled for Martin Pharma.
- Cloud Run, Artifact Registry, Cloud Build and IAM APIs are disabled.
- The existing identity received none of the requested Cloud Run deployment, service-account creation/act-as, project-IAM modification or Artifact Registry creation/upload permissions in the project's testIamPermissions response.
- Billing inspection returned HTTP 403. Billing status is unknown, not confirmed disabled.
- Runtime inspection returned HTTP 403. This does not establish that no runtime exists elsewhere.

The report is available as the finance-v2-deployment-preflight artifact on that workflow run. It contains configuration identifiers and flag states, not tokens, balances, patient records, staff records or account credentials.

## Required infrastructure action

A Google Cloud project/billing administrator must confirm billing availability, enable the required hosting services and provide an authorised deployment identity. For a Cloud Run pilot in europe-west1, provision an Artifact Registry container repository and a dedicated runtime service account. The deployment identity needs permission to push to that repository, deploy/update the designated pilot service and act as that runtime account. The runtime identity needs the required named-Firestore data access and Firebase Auth token/user-revocation verification access. Do not grant broad Owner access or put service-account keys in a container or browser bundle.

Cloud Build is optional if GitHub Actions builds the already-tested Docker image and pushes it directly. Do not enable unused services merely because they were inspected. Explicitly approved billing changes must be handled by the billing owner; this workflow does not attach a billing account or change a Firebase plan.

An existing approved HTTPS Node/container host with a secure runtime identity is an alternative. Its host and deployment connection must be supplied; none is configured in this repository.

## Remaining approved execution sequence

1. Build the reviewed Finance V2 image using finance-v2-backend/Dockerfile and publish the exact reviewed version.
2. Deploy the API with required project/database/origin settings, polling disabled initially, and all tenant Finance V2 switches still off. Use minimum zero and a conservative maximum instance limit for a pilot, with request-based CPU where supported.
3. Verify unauthenticated and invalid-token denial, real Firebase authentication, the selected runtime identity's named-database connection, tenant/branch isolation and disabled financial posting. Do not fabricate a staff login or impersonate a user to obtain a test token.
4. Connect an isolated pilot frontend to the deployed API and verify the signed-in owner/authorised Finance user. Do not replace production Hosting merely to test connectivity.
5. Recheck Firestore rules/index readiness, then arrange the approved controlled pilot activation and separately authorised test accounts/amounts. Do not migrate balances, replay historical transactions or treat approval to deploy as an authorised financial test transaction.

The backend implementation, emulator acceptance and container startup test remain completed as documented in PR #88. An actual service URL, runtime-authenticated database acceptance and pilot activation remain pending. Deployment has not occurred.
