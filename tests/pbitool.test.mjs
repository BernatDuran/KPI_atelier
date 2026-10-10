import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { handlePbiApi, runBridge } from '../scripts/pbi_api.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));

test('kpi-atelier.pbitool.json strictly conforms to Microsoft External Tools specification', () => {
  const pbitoolPath = path.join(root, 'kpi-atelier.pbitool.json');
  assert.equal(existsSync(pbitoolPath), true, 'kpi-atelier.pbitool.json must exist in root');

  const raw = readFileSync(pbitoolPath, 'utf8');
  const tool = JSON.parse(raw);

  // Required Microsoft schema keys
  assert.equal(typeof tool.version, 'string', 'version must be string');
  assert.equal(tool.version, '1.0', 'version must be 1.0');
  assert.equal(tool.name, 'KPI Atelier', 'name must be KPI Atelier');
  assert.equal(typeof tool.description, 'string', 'description must be provided');
  assert.equal(tool.description.length > 10, true, 'description must not be empty');
  assert.equal(typeof tool.path, 'string', 'path must be string pointing to launcher');
  assert.equal(tool.path.toLowerCase().endsWith('kpi-atelier.cmd'), true, 'path must point to kpi-atelier.cmd');

  // Arguments
  assert.equal(typeof tool.arguments, 'string', 'arguments must be provided');
  assert.equal(tool.arguments.includes('%server%'), true, 'arguments must pass %server%');
  assert.equal(tool.arguments.includes('%database%'), true, 'arguments must pass %database%');

  // iconData: strictly NO "data:" prefix per Microsoft spec
  assert.equal(typeof tool.iconData, 'string', 'iconData must be provided');
  assert.equal(tool.iconData.startsWith('data:'), false, 'iconData MUST NOT start with data: per Microsoft specification');
  assert.equal(tool.iconData.startsWith('image/png;base64,'), true, 'iconData must start with image/png;base64,');

  // Verify Base64 decodes to valid PNG magic bytes: 0x89 0x50 0x4E 0x47 (\x89PNG)
  const b64 = tool.iconData.replace('image/png;base64,', '');
  const buf = Buffer.from(b64, 'base64');
  assert.equal(buf[0], 0x89, 'PNG byte 0');
  assert.equal(buf[1], 0x50, 'PNG byte 1 (P)');
  assert.equal(buf[2], 0x4E, 'PNG byte 2 (N)');
  assert.equal(buf[3], 0x47, 'PNG byte 3 (G)');
});

test('kpi-atelier.cmd Windows launcher script exists and configures App Mode', () => {
  const cmdPath = path.join(root, 'kpi-atelier.cmd');
  assert.equal(existsSync(cmdPath), true, 'kpi-atelier.cmd must exist');

  const content = readFileSync(cmdPath, 'utf8');
  assert.equal(content.includes('8080'), true, 'launcher must reference default port 8080');
  assert.equal(content.includes('scripts\\serve.mjs'), true, 'launcher must start serve.mjs if offline');
  assert.equal(content.includes('--app='), true, 'launcher must invoke msedge with --app for chromeless window');
  assert.equal(content.includes('%SERVER_ARG%'), true, 'launcher must pass server parameter');
});

test('scripts/install-pbitool.ps1 and uninstall-pbitool.ps1 exist and target External Tools directory', () => {
  const installPath = path.join(root, 'scripts/install-pbitool.ps1');
  const uninstallPath = path.join(root, 'scripts/uninstall-pbitool.ps1');

  assert.equal(existsSync(installPath), true, 'install script must exist');
  assert.equal(existsSync(uninstallPath), true, 'uninstall script must exist');

  const installContent = readFileSync(installPath, 'utf8');
  assert.equal(installContent.includes('Microsoft Shared\\Power BI Desktop\\External Tools'), true);
  assert.equal(installContent.includes('image/png;base64'), true);

  const uninstallContent = readFileSync(uninstallPath, 'utf8');
  assert.equal(uninstallContent.includes('Microsoft Shared\\Power BI Desktop\\External Tools'), true);
});

test('pbi_bridge.ps1 supports discover and status actions', async () => {
  const instances = await runBridge(['-Action', 'discover']);
  assert.equal(instances.success, true, 'discover must succeed');
  assert.equal(Array.isArray(instances.instances), true, 'instances must be an array');

  if (instances.instances.length > 0) {
    const first = instances.instances[0];
    const status = await runBridge(['-Action', 'status', '-Server', first.server]);
    assert.equal(status.success, true);
    assert.equal(status.connected, true);
    assert.equal(Array.isArray(status.databases), true);
  }
});
