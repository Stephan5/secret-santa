# Secret Santa

[![CI](https://github.com/Stephan5/secret-santa/actions/workflows/ci.yml/badge.svg)](https://github.com/Stephan5/secret-santa/actions/workflows/ci.yml)

Secret Santa, without the hat. Put everyone's names in, draw them all at once, and send one link: each person picks their name and sees who they're buying for, on their own phone, wherever they are.

[santa.blakeslee.uk](https://santa.blakeslee.uk)

## How it works

- **A Secret Santa** (a *group* in the code) has a name, an organiser password, the names in the hat (*people*), some rules, and its *draws*: 2026, 2027 and so on. Anyone can start one. It lives at `/g/<uuid>`, and the link is the only way in: nothing lists them.
- **The organiser** signs in at `/g/<uuid>/admin` with the password to add, rename and take out people, set the rules, and create, run, redo and delete draws. They see who has opened their name, never who has whom.
- **A draw** pairs up some of the people, chosen when it's created, all at once on the server, so nobody's left holding their own name. Until anyone has looked, it can be drawn again, undone or deleted.
- **Opening a name** is tied to the first browser to do it: that one can come back to it, any other is told it's already been opened. So peeking can't be stopped (anyone with the link can open a name nobody's opened yet), but it shows: the real person finds theirs already opened, and asks the organiser, who can reset it.
- **Results** can be shown to everyone from a date and time set on the draw (Christmas Day, say). Before then nobody, the organiser included, can see a pairing but its giver.
- **Rules**: people who never draw each other (couples, either way round), not getting who you had in the last N draws (one, by default), no swaps (if A has B, B doesn't have A), and one big loop (A → B → C → … → A). When no draw fits, it says which rules are in the way.

The site never calls a person "a Secret Santa", which could mean either end of a pairing: you're "buying for" someone.

## Tech stack

- **React 19 + TypeScript**, built with **Vite 8**: a single-page app, plain CSS, always dark (a Christmas night, in space), in Baloo 2 and Space Mono (OFL, in `src/web/fonts/`)
- **AWS Lambda** (Node 22) for the API, **DynamoDB** to keep things, behind **CloudFront** with the site on **S3**
- **Terraform** for all of it
- **Node's test runner** for the unit tests, **Playwright** end to end, **Oxlint**

TypeScript runs straight in Node (which strips the types), so the API, scripts and tests need no build step; only the Lambda is bundled, by esbuild.

## Project structure

- `src/shared/`: the API's request and response types, and the limits on names and so on, used by both ends
- `src/api/`
  - `draw.ts`: drawing names (below)
  - `app.ts`: the API's routes and what each does, given a store, a clock and randomness, so the tests run it whole
  - `store/`: where things are kept. `store.ts` is the interface, `dynamo.ts` DynamoDB's implementation (its comment has the table's layout), `memory.ts` an in-memory one for development and tests
  - `secrets.ts`: ids, tokens and scrypt password hashing; `validate.ts`, `views.ts`, `http.ts`: checking requests, shaping responses
  - `lambda.ts`: the Lambda's entry point; `local-server.ts`: CloudFront's stand-in locally
- `src/web/`: the site. `pages/` has one component per page (Home, Create, GroupPage, Admin), `api.ts` the API client, `device.ts` this browser's token, `router.ts` the routing
- `scripts/`: `dev.ts` (local development), `serve.ts` (the built site and API together, for the end-to-end tests), `build-api.ts` (bundles the Lambda)
- `e2e/`: Playwright tests
- `infra/`: Terraform. `bootstrap/` is applied once by hand; the rest by CI on every push to master

## Local development

```
npm install
npm run dev      # the site on http://localhost:5173, the API on :8787
npm run build    # type-check, build the site (dist/) and bundle the Lambda (dist-api/)
npm run lint
npm test         # unit tests
npm run e2e      # end-to-end tests (first time: npx playwright install chromium)
```

`npm run dev` keeps its data in memory, saved to `.dev-data.json` between restarts: delete it to start afresh.

The store's tests run against the in-memory store, and against DynamoDB too when `DYNAMODB_ENDPOINT` is set, as CI does. To run them against [DynamoDB Local](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/DynamoDBLocal.html) yourself:

```
docker run --rm -p 8000:8000 amazon/dynamodb-local:2.6.1
DYNAMODB_ENDPOINT=http://localhost:8000 npm test
```

## Drawing names

`src/api/draw.ts`. A draw is a random permutation of the people in it, in which nobody gets themselves and every rule holds. It shuffles until a shuffle fits, so every draw that fits is equally likely. If the rules leave so few that 20,000 shuffles all miss, it searches for one instead (still random, though not quite uniform), or proves there isn't one, and then tries dropping each rule in turn to say which are in the way. Randomness comes from `crypto.randomInt`.

Its tests (`draw.test.ts`) check, against a brute-force enumeration of hundreds of random small groups and rule sets, that it finds a draw exactly when one exists and that every draw keeps every rule, and that each possible draw comes up equally often (chi-squared).

## Security

- **Links**: a group's id is a random UUID, and knowing it is what lets you see the group and open names. Nothing lists groups. Every page is `noindex`.
- **The organiser password** is hashed with scrypt at OWASP's recommended cost (N = 2^17, r = 8, p = 1). Signing in gives a session token, good for 12 hours, kept in the tab's `sessionStorage`; the API stores only its hash. Ten wrong passwords in a row lock a group's sign-in for 15 minutes. There's no recovery yet.
- **Opening a name** sends a random token the browser keeps in `localStorage`; the API keeps its hash on the pairing, set by one conditional write, so only one browser can ever win it.
- **Rate limits**: an address can start ten Secret Santas an hour.
- **The organiser can't see pairings**, but could see them all by setting the results date to now, which shows them to everyone, so it would be noticed.
- **AWS**: the bucket and the Lambda's function URL are private, reached only through CloudFront with Origin Access Control. The Lambda's role can only read and write its table and write its logs. Responses carry a strict content security policy (`infra/security-headers.json`), which the local server applies too, so the end-to-end tests would catch a page breaking it.

## Infrastructure

```
            santa.blakeslee.uk (Route 53 → CloudFront, ACM certificate)
                 │
   ┌─────────────┴──────────────┐
   │ /*                         │ /api/*
   ▼                            ▼
 S3 bucket (dist/)        Lambda function URL (dist-api/) ──▶ DynamoDB
 SPA rewrite function     signed by CloudFront (OAC)
```

- `infra/`: the site's bucket (`site.tf`), the distribution, its policies and the SPA rewrite function (`cdn.tf`, `spa-rewrite.js`), the Lambda, its role and the table (`api.tf`), and the certificate and DNS records (`dns.tf`). State is in S3, locked with S3's own lock files.
- `infra/bootstrap/`: the role GitHub Actions deploys with, and the permissions boundary on any role that role makes. See below.

Browsers send their request bodies' SHA-256 in `x-amz-content-sha256` (`src/web/api.ts`): CloudFront has to sign its requests to the function URL, body included, and can't hash the body itself.

It costs next to nothing: Lambda and DynamoDB charge per request (Lambda's free tier is a million a month, and DynamoDB's on-demand charges for a family's worth come to fractions of a penny), and the rest is CloudFront's and Route 53's pennies.

### CI and deploys

`.github/workflows/ci.yml`, on every pull request and push to master:

1. **test**: lint, build (with its type-check), unit tests (against DynamoDB Local too), end-to-end tests
2. **terraform**: `fmt` and `validate` both configs
3. **deploy**, on pushes to master once both pass: assumes the deploy role by OIDC (no AWS secrets in the repo), `terraform apply`, uploads the site (hashed assets cached for a year, `index.html` never), invalidates CloudFront, and checks the API answers through it, a GET and a signed POST

### The deploy role

The role (`infra/bootstrap/main.tf`) trusts only this repository's pushes to master, by its owner and repository ids as well as names, so a re-created repository of the same name doesn't match. It can manage only what's named `secret-santa*`: the site bucket, the table, the Lambda, its log group, the state; DNS records for `santa.blakeslee.uk` (and its certificate's validation records) only; and CloudFront, apart from the distributions it's told to leave alone. Any role it creates or changes must carry the `secret-santa-boundary` permissions boundary, which allows no more than the API needs, so it can't use a Lambda to get more than it has.

### First-time setup

Once, with your own AWS credentials (an administrator's), from the repository's root:

1. Make the bucket for Terraform's state:

   ```
   ./infra/bootstrap/create-state-bucket.sh secret-santa-tfstate-<account id>
   ```

2. Make the deploy role. Copy `infra/bootstrap/terraform.tfvars.example` to `terraform.tfvars` beside it and fill it in, then:

   ```
   cd infra/bootstrap
   terraform init -backend-config="bucket=secret-santa-tfstate-<account id>"
   terraform apply
   ```

3. In the repository's settings (Secrets and variables → Actions → Variables), set:
   - `AWS_DEPLOY_ROLE_ARN`: the `deploy_role_arn` the apply printed
   - `TF_STATE_BUCKET`: the bucket's name

4. Push to master, or re-run the latest CI run. The first deploy makes everything; the certificate's validation and the new distribution take a while.

Until the variables are set, CI tests everything and skips the deploy.

## Still to do

- Recovering a forgotten organiser password, perhaps by email
- Wish lists, or asking your Secret Santa a question anonymously
