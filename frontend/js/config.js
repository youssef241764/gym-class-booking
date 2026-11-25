// Where are the APIs? (Lab 7 pattern: chosen from the address the page was loaded from)
//   page on port 8080 -> your PC: each service runs with "npm run dev" on ports 3001-3004
//   page on port 4566 -> Floci:   the page comes from S3 and calls API Gateway
// Public values only (web addresses). Never put a secret in this file.
// The FLOCI_API lines are written by infra/deploy-frontend.sh (you can also paste them by hand).
const PC_API = {
  identity: 'http://localhost:3001',
  classes: 'http://localhost:3002',
  bookings: 'http://localhost:3003',
  attendance: 'http://localhost:3004',
};
const FLOCI_API = {
  identity: 'http://c4dc524553.execute-api.localhost.floci.io:4566',
  classes: 'http://04e2cdcad1.execute-api.localhost.floci.io:4566',
  bookings: 'http://39dd76a2a0.execute-api.localhost.floci.io:4566',
  attendance: 'http://316839148b.execute-api.localhost.floci.io:4566',
};
const onFloci = window.location.port === '4566';
window.GYM_CONFIG = { runtime: onFloci ? 'floci' : 'pc', api: onFloci ? FLOCI_API : PC_API };
