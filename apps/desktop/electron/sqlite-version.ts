/** Rejects versions affected by SQLite's WAL-reset bug before WAL is enabled. */
export function isSafeSqliteVersion(version:unknown):boolean {
 if(typeof version!=='string'||!/^\d+\.\d+\.\d+$/.test(version))return false;
 const parts=version.split('.').map(Number);if(parts.some(value=>!Number.isSafeInteger(value)))return false;
 const [major,minor,patch]=parts;
 if(major>3)return true;
 if(major!==3)return false;
 if(minor>51)return true;
 if(minor===51)return patch>=3;
 return (minor===50&&patch>=7)||(minor===44&&patch>=6);
}
export function requireSafeSqliteVersion(version:unknown):void {if(!isSafeSqliteVersion(version))throw new Error('SQLite version is not approved for WAL')}
