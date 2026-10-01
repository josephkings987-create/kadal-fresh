const bcrypt = require('bcryptjs');
const db = require('./db');
const hash = bcrypt.hashSync('Selva54321', 12);
db.exec(`UPDATE admins SET password_hash = '${hash}', must_change_password = 1, auth_version = auth_version + 1, updated_at = CURRENT_TIMESTAMP WHERE username = 'Selva'`);
console.log(JSON.stringify(db.prepare("SELECT id, username, must_change_password, auth_version FROM admins WHERE username = 'Selva'").get(), null, 2));
