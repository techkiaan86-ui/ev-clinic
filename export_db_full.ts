import dotenv from 'dotenv';
dotenv.config({ path: './src/.env' });

import { PrismaClient } from '@prisma/client';
import fs from 'fs';
import path from 'path';

const prisma = new PrismaClient();

async function main() {
    console.log('Generating MariaDB/XAMPP compatible SQL dump...');
    const tables = [
        'clinic',
        'user',
        'clinicstaff',
        'department',
        'patient',
        'appointment',
        'service_order',
        'invoice',
        'invoice_item',
        'medical_report',
        'formtemplate',
        'auditlog',
        'staff_document'
    ];

    let sqlOutput = `-- Clinic System Full Database Dump (MariaDB/XAMPP Compatible)\n-- Exported At: ${new Date().toISOString()}\n\nSET FOREIGN_KEY_CHECKS=0;\n\n`;

    for (const table of tables) {
        try {
            // 1. Get CREATE TABLE statement directly from MySQL
            const createResult: any[] = await prisma.$queryRawUnsafe(`SHOW CREATE TABLE \`${table}\``);
            if (createResult && createResult[0]) {
                const rowObj = createResult[0];
                const rawCreateSql = Object.values(rowObj).find(val => typeof val === 'string' && val.toUpperCase().includes('CREATE TABLE')) as string;
                if (rawCreateSql) {
                    // Replace MySQL 8 specific collations with MariaDB compatible collations
                    const compatibleSql = rawCreateSql
                        .replace(/utf8mb4_0900_ai_ci/g, 'utf8mb4_unicode_ci')
                        .replace(/utf8mb4_0900_bin/g, 'utf8mb4_bin');

                    sqlOutput += `-- Structure for \`${table}\`\n`;
                    sqlOutput += `DROP TABLE IF EXISTS \`${table}\`;\n`;
                    sqlOutput += `${compatibleSql};\n\n`;
                }
            }

            // 2. Get Data
            const data = await (prisma as any)[table].findMany();
            console.log(`Exported ${table}: ${data.length} records`);

            if (data.length > 0) {
                sqlOutput += `-- Data for \`${table}\`\n`;
                for (const row of data) {
                    const keys = Object.keys(row);
                    const cols = keys.map(k => `\`${k}\``).join(', ');
                    const vals = keys.map(k => {
                        const val = row[k];
                        if (val === null || val === undefined) return 'NULL';
                        if (typeof val === 'number' || typeof val === 'boolean') return val;
                        if (val instanceof Date) return `'${val.toISOString().slice(0, 19).replace('T', ' ')}'`;
                        if (typeof val === 'object') return `'${JSON.stringify(val).replace(/'/g, "''")}'`;
                        return `'${String(val).replace(/'/g, "''")}'`;
                    }).join(', ');

                    sqlOutput += `INSERT INTO \`${table}\` (${cols}) VALUES (${vals});\n`;
                }
                sqlOutput += `\n`;
            }
        } catch (err: any) {
            console.error(`Error exporting table ${table}:`, err?.message || err);
        }
    }

    sqlOutput += `SET FOREIGN_KEY_CHECKS=1;\n`;

    const dumpPathSql = path.join(process.cwd(), '..', 'database_dump.sql');
    fs.writeFileSync(dumpPathSql, sqlOutput, 'utf-8');

    console.log(`\nMariaDB/XAMPP Compatible SQL Dump saved to: ${dumpPathSql}`);
}

main()
    .catch((e) => {
        console.error('Export failed:', e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
