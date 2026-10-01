const bcrypt = require('bcryptjs');
const db = require('./db');
const hash = bcrypt.hashSync('KadalFresh2026!Strong', 12);
db.prepare('UPDATE admins SET password_hash = ?, must_change_password = 1, auth_version = auth_version + 1, updated_at = CURRENT_TIMESTAMP WHERE username = ?').run(hash, 'Selva');
console.log(JSON.stringify(db.prepare('SELECT id, username, must_change_password, auth_version FROM admins WHERE username = ?').get('Selva')));
