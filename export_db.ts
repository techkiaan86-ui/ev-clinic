import dotenv from 'dotenv';
dotenv.config({ path: './src/.env' });

import { PrismaClient } from '@prisma/client';
import fs from 'fs';
import path from 'path';

const prisma = new PrismaClient();

async function main() {
    console.log('Starting database export...');
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

    const dbDump: Record<string, any[]> = {};
    let sqlOutput = `-- Clinic System Database Dump\n-- Exported At: ${new Date().toISOString()}\n\nSET FOREIGN_KEY_CHECKS=0;\n\n`;

    for (const table of tables) {
        try {
            const data = await (prisma as any)[table].findMany();
            dbDump[table] = data;
            console.log(`Exported ${table}: ${data.length} records`);

            if (data.length > 0) {
                sqlOutput += `-- Table structure and data for \`${table}\`\n`;
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
    const dumpPathJson = path.join(process.cwd(), '..', 'database_dump.json');

    fs.writeFileSync(dumpPathSql, sqlOutput, 'utf-8');
    fs.writeFileSync(dumpPathJson, JSON.stringify(dbDump, null, 2), 'utf-8');

    console.log(`\nDatabase exported successfully!`);
    console.log(`SQL Dump saved to: ${dumpPathSql}`);
    console.log(`JSON Dump saved to: ${dumpPathJson}`);
}

main()
    .catch((e) => {
        console.error('Export failed:', e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
