import path from "path";
import { extraResourcesPath, isDev, platformName, userDataPath } from "../../../utils/environment";

if (process.env.DATABASE_FILENAME === undefined) { process.env.DATABASE_FILENAME = "vcs.db" }

export const databasePath = isDev ? path.join(__dirname, process.env.DATABASE_FILENAME) : path.join(userDataPath, process.env.DATABASE_FILENAME);
export const databaseUrl  = "file:" + databasePath + "?connection_limit=1";

console.log("Database Path: " + databasePath)
console.log("Database URL: "  + databaseUrl)

// Hacky, but putting this here because otherwise at query time the Prisma client
// gives an error "Environment variable not found: DATABASE_URL" despite us passing
// the databaseURL into the prisma client constructor in datasources.db.url
process.env.DATABASE_URL = databaseUrl;

// This needs to be updated every time you create a migration!
export const latestMigration = "20230726170237_init";
export const platformToExecutables: any = {
    win32: {
        schemaEngine: 'schema-engine-windows.exe',
        queryEngine: 'query_engine-windows.dll.node',
    },
    linux: {
        schemaEngine: 'schema-engine-debian-openssl-1.1.x',
        queryEngine: 'libquery_engine-debian-openssl-1.1.x.so.node'
    },
    darwin: {
        schemaEngine: 'schema-engine-darwin',
        queryEngine: 'libquery_engine-darwin.dylib.node'
    },
    darwinArm64: {
        schemaEngine: 'schema-engine-darwin-arm64',
        queryEngine: 'libquery_engine-darwin-arm64.dylib.node',
    }
};

const schemaEngine = platformToExecutables[platformName].schemaEngine
const queryEngine  = platformToExecutables[platformName].queryEngine

export const schemaEnginePath = isDev
    ? path.join(extraResourcesPath, "node_modules", "@prisma", "engines", schemaEngine)
    : path.join(extraResourcesPath, "engines", schemaEngine)

export const queryEnginePath  = isDev 
    ? path.join(extraResourcesPath, "node_modules", "@prisma", "engines", queryEngine)
    : path.join(extraResourcesPath, "app.asar.unpacked", "node_modules", "@prisma", "engines", queryEngine)