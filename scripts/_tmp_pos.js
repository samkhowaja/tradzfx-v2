const fs = require("fs");
const sql = fs.readFileSync("C:\\tradzfx-v2\\scripts\\_tmp_last_sql.sql", "utf8");
console.log("LEN", sql.length);
console.log("AROUND 534:", JSON.stringify(sql.slice(500, 580)));
