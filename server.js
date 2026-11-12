// Local runner: `npm start`. On Vercel the app is served through api/index.js instead.
const app = require('./app');

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Store running at http://localhost:${port}`);
  console.log(process.env.ADMIN_PASSWORD
    ? `Admin page: http://localhost:${port}/admin`
    : 'Admin is off: add ADMIN_PASSWORD to .env to turn it on.');
});
