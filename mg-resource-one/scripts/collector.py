#!/usr/bin/python3
"""仅输出白名单运行指标，不接受参数，不读取业务数据或环境变量。"""
import datetime, json, os, platform, shutil, subprocess, sys
if len(sys.argv) != 1:
    sys.exit(64)
def command(args):
    try:
        return subprocess.run(args, capture_output=True, text=True, timeout=8, check=True).stdout.strip()
    except (OSError, subprocess.SubprocessError):
        return None
memory = {}
with open('/proc/meminfo') as source:
    for line in source:
        k, v = line.split(':', 1)
        if k in ('MemTotal', 'MemAvailable'):
            memory[k] = int(v.strip().split()[0]) * 1024
disk = shutil.disk_usage('/')
containers = []
raw = command(['/usr/bin/docker', 'ps', '-a', '--format', '{{json .}}'])
if raw is not None:
    for line in raw.splitlines():
        item = json.loads(line)
        containers.append({k: item.get(k, '') for k in ('Names', 'Image', 'State', 'Status')})
services = [{'name': name, 'state': command(['/usr/bin/systemctl', 'is-active', name]) or 'inactive-or-unavailable'}
    for name in ('mg-expert-database-api', 'mg-resource-one')]
print(json.dumps({'schemaVersion': 1, 'collectedAt': datetime.datetime.now(datetime.timezone.utc).isoformat(),
    'hostname': platform.node(), 'system': platform.system() + ' ' + platform.release(),
    'cpuCount': os.cpu_count(), 'loadAverage': list(os.getloadavg()),
    'memoryTotal': memory.get('MemTotal'), 'memoryAvailable': memory.get('MemAvailable'),
    'diskTotal': disk.total, 'diskFree': disk.free,
    'containers': containers, 'dockerAvailable': raw is not None,
    'services': services,
    'desktopRelease': os.path.basename(os.path.realpath('/opt/mg-desktop/current')) if os.path.exists('/opt/mg-desktop/current') else None,
    'expertRelease': os.path.basename(os.path.realpath('/opt/mg-expert-database/current')) if os.path.exists('/opt/mg-expert-database/current') else None}))
