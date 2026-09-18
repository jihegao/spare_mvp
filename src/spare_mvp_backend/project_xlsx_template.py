"""Schema-derived relational worksheets for clean Project data (no model compiler)."""
from __future__ import annotations

import hashlib
import json
import math
from pathlib import Path
from typing import Any

from openpyxl import Workbook
from openpyxl.styles import Alignment, Font, PatternFill
from openpyxl.utils import get_column_letter

from src.spare_mvp_backend.xlsx_text import workbook_bytes

ROOT = Path(__file__).resolve().parents[2]
VERSION = 'project-xlsx-v1'
GUIDE = '填写说明'
FIELDS = '字段说明'
EXTRAS = '扩展字段'
KEYS = ['记录ID', '父记录ID', '顺序', '节点类型', '值']
EXTRA_HEADERS = ['记录ID', '父记录ID', '字段或序号', '节点类型', '值']
DOMAINS = {'missionProfile': '任务', 'basicMissions': '任务', 'combatUnit': '装备',
           'products': '装备', 'components': '装备', 'equipment': '装备',
           'reliabilityBlockDiagram': '装备', 'airports': '保障组织',
           'supportNodes': '保障组织', 'supportResources': '保障组织',
           'transportPolicies': '保障组织', 'supportOrganization': '保障组织',
           'supportActivities': '保障活动', 'supportActivityJobs': '保障活动'}
DOMAIN_ORDER = ['任务', '装备', '保障组织', '保障活动', '项目信息']


def schema():
    return json.loads((ROOT / 'contracts/aircraft_support_v1_project.schema.json').read_text(encoding='utf-8'))


def schema_hash():
    return hashlib.sha256(json.dumps(schema(), sort_keys=True, ensure_ascii=False).encode()).hexdigest()


def resolved(node, document):
    result = dict(node)
    if '$ref' in node:
        target = document
        for part in node['$ref'].removeprefix('#/').split('/'):
            target = target[part]
        result = {**resolved(target, document), **{k: v for k, v in node.items() if k != '$ref'}}
    properties = dict(result.get('properties', {}))
    types = set([result['type']] if isinstance(result.get('type'), str) else result.get('type', []))
    required = set(result.get('required', []))
    enum_values = result.get('enum', [result['const']] if 'const' in result else [])
    if not types and enum_values:
        types.update(kind(value) for value in enum_values)
    for key in ('oneOf', 'anyOf', 'allOf'):
        for branch in result.get(key, []):
            branch = resolved(branch, document)
            properties.update(branch.get('properties', {}))
            types.update(branch.get('_types', []))
            if key == 'allOf':
                required.update(branch.get('required', []))
    if 'then' in result:
        properties.update(resolved(result['then'], document).get('properties', {}))
    result.update(properties=properties, _types=types, required=sorted(required))
    return result


def table_mapping():
    document = schema()
    tables = []

    def walk(path, node, parent_path=None, field=None, is_array=False, ancestry=()):
        reference = node.get('$ref')
        node = resolved(node, document)
        table = {'path': path, 'node': node, 'parent_path': parent_path, 'field': field,
                 'array': is_array, 'properties': node.get('properties', {})}
        tables.append(table)
        if reference and reference in ancestry: return
        ancestry = (*ancestry, reference) if reference else ancestry
        # References are finite in this contract. Unknown/open descendants use EXTRAS.
        for name, prop in table['properties'].items():
            child = resolved(prop, document)
            if 'array' in child['_types']:
                walk(path + (name, '[]'), child.get('items', {}), path, name, True, ancestry)
            elif 'object' in child['_types']:
                walk(path + (name,), prop, path, name, False, ancestry)
    walk((), document)
    tables.sort(key=lambda t: (-1 if not t['path'] else DOMAIN_ORDER.index(DOMAINS.get(t['path'][0], '项目信息')), t['path']))
    for index, table in enumerate(tables):
        path = table['path']
        domain = DOMAINS.get(path[0], '项目信息') if path else '项目信息'
        label = next((p for p in reversed(path) if p != '[]'), 'Project')
        table['sheet'] = '项目信息' if not path else f'{domain}{index:02d}_{label}'[:31]
        table['headers'] = [*KEYS, *table['properties']]
    return tables


def kind(value):
    if value is None: return 'null'
    if isinstance(value, bool): return 'boolean'
    if isinstance(value, int): return 'integer'
    if isinstance(value, float): return 'number'
    if isinstance(value, str): return 'string'
    if isinstance(value, dict): return 'object'
    if isinstance(value, list): return 'array'
    raise ValueError('Unsupported Project value type')


def encode(value):
    if isinstance(value, str) and len(value) > 32767:
        raise ValueError('文本超过 Excel 单元格 32767 字符上限')
    if isinstance(value, float):
        if not math.isfinite(value): raise ValueError('Excel 不支持非有限数值')
        if float(format(value, '.16g')) != value: return '@number:' + repr(value)
    if isinstance(value, int) and not isinstance(value, bool) and abs(value) > 999999999999999:
        return '@integer:' + str(value)
    if value is None: return '@null'
    if isinstance(value, (dict, list)): return '@' + kind(value)
    if value == '': return '@empty'
    if isinstance(value, str) and value.startswith(('@', '~', '=')): return '~' + value
    return value


def decode(value):
    if isinstance(value, str):
        if value.startswith('~'): return value[1:]
        if value.startswith('@integer:'): return int(value[9:])
        if value.startswith('@number:'):
            number = float(value[8:])
            if not math.isfinite(number): raise ValueError('数值必须有限')
            return number
        markers = {'@null': None, '@empty': '', '@object': {}, '@array': []}
        if value in markers: return markers[value]
        if value.startswith('@'): raise ValueError('未知保留标记；原文以 @ 开头时加 ~ 前缀')
    return value


def field_path(path):
    return '.'.join(path).replace('.[]', '[]')


def export_project_xlsx(project):
    tables = table_mapping()
    by_path = {t['path']: t for t in tables}
    rows = {t['path']: [] for t in tables}
    extras = []
    serial = 0

    def identifier():
        nonlocal serial
        serial += 1
        return f'row-{serial}'

    def extra(value, parent, field):
        row_id = identifier()
        extras.append([row_id, parent, field, kind(value), None if isinstance(value, (dict, list)) else encode(value)])
        children = value.items() if isinstance(value, dict) else enumerate(value) if isinstance(value, list) else []
        for key, child in children: extra(child, row_id, key)

    def visit(value, path, parent='', index=None):
        table = by_path[path]
        row_id = identifier()
        record = [row_id, parent, index, kind(value), None if isinstance(value, (dict, list)) else encode(value)]
        record.extend(encode(value[name]) if isinstance(value, dict) and name in value else None for name in table['properties'])
        rows[path].append(record)
        if isinstance(value, dict):
            for name, child in value.items():
                if name not in table['properties']:
                    extra(child, row_id, name)
                    continue
                child_path = path + (name, '[]') if isinstance(child, list) else path + (name,)
                if isinstance(child, list) and child_path in by_path:
                    for position, item in enumerate(child): visit(item, child_path, row_id, position)
                elif isinstance(child, dict) and child_path in by_path:
                    visit(child, child_path, row_id)
                elif isinstance(child, (dict, list)):
                    # Schema-open property: keep its marker on the parent, expand children.
                    record[5 + list(table['properties']).index(name)] = None
                    extra(child, row_id, name)
        elif isinstance(value, list):
            for position, item in enumerate(value): extra(item, row_id, position)

    visit(project, ())
    workbook = Workbook()
    workbook.remove(workbook.active)
    guide = workbook.create_sheet(GUIDE)
    for row in [
        ['格式版本', VERSION], ['schema_sha256', schema_hash()],
        ['填写顺序', '任务、装备、保障组织、保障活动；项目信息保存项目身份。'],
        ['使用方法', '这是可编译示例模板。保留表头，替换示例；新增行时设置唯一记录ID。'],
        ['记录ID', '工作簿内部关联键；父记录ID指向所属对象行，不能用显示名称替代。业务id/productId等仍填写稳定业务ID。'],
        ['顺序', '数组从0开始连续编号；父记录ID相同的同一子表内不得重复。'],
        ['嵌套字段', '@object / @array 表示存在对象/集合，在对应子表填子项。空集合保留标记并不填写子行。'],
        ['空值', '空白表示字段不存在；@empty表示空文本；@null表示null。合法性仍由Project契约校验。'],
        ['精确数值', '超出Excel有效位数的数字使用@integer:或@number:标记保真；普通数量仍直接填数字。'],
        ['原文', '原文以@、~、=开头时加~前缀；布尔值使用Excel TRUE/FALSE，数字用数字单元格。禁止公式。'],
        ['扩展字段', '开放对象的额外键在扩展字段表逐行填写；父记录ID、字段或序号、节点类型和值明确关联，不填写JSON。'],
        ['稳定引用', '任务引用basicMissionId/compositeTaskId；装备引用productId/parentId；组织引用supportNodeId；工作项前驱使用业务ID。完整关系由导入预览校验。'],
        ['导入流程', '上传后先预览并编译校验；确认前不写入项目，确认时选择覆盖或新建。'],
    ]: guide.append(row)
    fields = workbook.create_sheet(FIELDS)
    fields.append(['工作表', '列', 'Project字段路径', '类型', '必填', '枚举或常量', '单位或范围', '说明'])
    for table in tables:
        sheet = workbook.create_sheet(table['sheet'])
        sheet.append(table['headers'])
        for row in rows[table['path']]: sheet.append(row)
        if table['node'].get('additionalProperties') is True or not table['properties']:
            fields.append([EXTRAS, '字段或序号', field_path(table['path']) + '.*', '按节点类型', '否', '', '', '开放字段/递归更深层按父记录ID逐项填写，容器拆行，无需JSON'])
        for name, prop in table['properties'].items():
            definition = resolved(prop, schema())
            types = definition['_types'] or {'由契约约束'}
            constraints = ', '.join(f'{key}={definition[key]}' for key in ('minimum','maximum','exclusiveMinimum','exclusiveMaximum','minItems','minLength') if key in definition)
            units = '小时' if 'Hours' in name else '分钟' if 'Minutes' in name else '天' if 'Days' in name else ''
            enum = definition.get('enum', [definition['const']] if 'const' in definition else [])
            fields.append([table['sheet'], name, field_path(table['path'] + (name,)), ','.join(sorted(types)),
                           '是' if name in table['node'].get('required', []) else '否（条件约束见导入校验）',
                           ', '.join(str(v) for v in enum), ' '.join([units,constraints]).strip(),
                           definition.get('description', '稳定业务ID或引用，不按名称猜测关联' if name.endswith(('Id','Ids')) or name == 'id' else '按类型填写；嵌套对象及数组通过子表填写')])
    ext = workbook.create_sheet(EXTRAS)
    ext.append(EXTRA_HEADERS)
    for row in extras: ext.append(row)
    for sheet in workbook:
        sheet.freeze_panes = 'F2' if sheet.title not in (GUIDE, FIELDS) else 'A2'
        sheet.auto_filter.ref = sheet.dimensions
        sheet.row_dimensions[1].height = 42
        for cell in sheet[1]:
            cell.font = Font(bold=True, color='FFFFFF')
            cell.fill = PatternFill('solid', fgColor='17365D')
        for column in range(1, sheet.max_column + 1):
            sheet.column_dimensions[get_column_letter(column)].width = 25 if sheet.title != GUIDE else (22 if column == 1 else 115)
        for row in sheet:
            for cell in row:
                cell.alignment = Alignment(vertical='top', wrap_text=True)
                if isinstance(cell.value, str): cell.data_type = 's'
        if sheet.title == GUIDE:
            for index in range(1, sheet.max_row + 1): sheet.row_dimensions[index].height = 38
    try:
        return workbook_bytes(workbook)
    finally:
        workbook.close()


def parse_standard_workbook(workbook):
    tables = table_mapping()
    expected = {GUIDE, FIELDS, EXTRAS, *(t['sheet'] for t in tables)}
    errors = []
    locations = {}
    nodes = {}
    attachments = []

    def issue(code, sheet, row, column, message, path='', value=''):
        if not path:
            table = next((item for item in tables if item['sheet'] == sheet), None)
            if table:
                field = table['headers'][column - 1] if column > 5 and column <= len(table['headers']) else ''
                path = field_path(table['path'] + ((field,) if field else ())) or '<root>'
            else:
                path = f'{sheet}.{column}'
        errors.append({'code': code, 'sheet': sheet, 'row': row, 'column': column, 'field': path,
                       'field_path': path, 'message': message, 'reference_value': value})

    for name in expected - set(workbook.sheetnames): issue('missing_sheet', name, 1, 1, '缺少标准模板工作表')
    for name in set(workbook.sheetnames) - expected: issue('unknown_sheet', name, 1, 1, '未知工作表，请使用当前标准模板')
    if GUIDE not in workbook.sheetnames: return {}, locations, errors
    if workbook[GUIDE]['B1'].value != VERSION:
        issue('unsupported_template_version', GUIDE, 1, 2, '不支持此模板版本，请下载当前版本')
    if workbook[GUIDE]['B2'].value != schema_hash():
        issue('unsupported_template_schema', GUIDE, 2, 2, '模板字段版本已变化，请下载当前模板后迁移数据')
    if errors: return {}, locations, errors

    def read_rows(name, headers):
        sheet = workbook[name]
        actual = [cell.value for cell in next(sheet.iter_rows(min_row=1, max_row=1))]
        if actual != headers:
            issue('invalid_header', name, 1, 1, '缺少、未知或顺序错误的列；请保留标准模板表头')
            return
        for number, cells in enumerate(sheet.iter_rows(min_row=2), 2):
            if all(cell.value is None for cell in cells): continue
            for index, cell in enumerate(cells, 1):
                if cell.data_type == 'f' or (isinstance(cell.value, str) and cell.value.startswith('=')):
                    issue('formula_not_supported', name, number, index, '禁止公式；原文以=开头时加~前缀')
                if isinstance(cell.value, str) and len(cell.value.encode()) > 100000:
                    issue('cell_too_large', name, number, index, '单元格文本超限')
            yield number, [cell.value for cell in cells]

    def register(row_id, value, sheet, number):
        if not isinstance(row_id, str) or not row_id:
            issue('missing_row_id', sheet, number, 1, '记录ID不能为空且必须是文本'); return False
        if row_id in nodes:
            issue('duplicate_row_id', sheet, number, 1, '记录ID重复', value=row_id); return False
        nodes[row_id] = value
        return True

    for table in tables:
        for number, row in read_rows(table['sheet'], table['headers']):
            row_id, parent, index, node_type, scalar = row[:5]
            try:
                value = {} if node_type == 'object' else [] if node_type == 'array' else decode(scalar)
                if node_type == 'number' and isinstance(value, int) and not isinstance(value, bool): value = float(value)
                if kind(value) != node_type:
                    raise ValueError('节点类型与值不一致')
                if isinstance(value, dict):
                    for name, raw in zip(table['properties'], row[5:]):
                        if raw is not None: value[name] = decode(raw)
                elif any(v is not None for v in row[5:]):
                    raise ValueError('非对象节点不得填写对象字段列')
            except ValueError as exc:
                issue('invalid_cell_type', table['sheet'], number, 5, str(exc)); continue
            if register(row_id, value, table['sheet'], number):
                attachments.append((row_id, parent, index, table, number, row))
    extra_entries = []
    for number, row in read_rows(EXTRAS, EXTRA_HEADERS):
        row_id, parent, key, node_type, raw = row
        try:
            value = {} if node_type == 'object' else [] if node_type == 'array' else decode(raw)
            if node_type == 'number' and isinstance(value, int) and not isinstance(value, bool): value = float(value)
            if kind(value) != node_type: raise ValueError('节点类型与值不一致')
        except ValueError as exc:
            issue('invalid_cell_type', EXTRAS, number, 5, str(exc)); continue
        if register(row_id, value, EXTRAS, number): extra_entries.append((row_id, parent, key, number))
    if errors: return {}, locations, errors
    paths = {}
    roots = [entry for entry in attachments if not entry[3]['path']]
    if len(roots) != 1 or roots[0][1] not in (None, '') or not isinstance(nodes[roots[0][0]], dict):
        issue('invalid_project_row', '项目信息', 2, 1, '项目信息必须且只能有一个无父记录的对象行')
        return {}, locations, errors
    root_id = roots[0][0]
    paths[root_id] = ''
    array_slots = {}
    object_slots = set()
    # Resolve ownership independently of worksheet row order.
    entries_by_id = {entry[0]: entry for entry in attachments}
    pending = [entry for entry in attachments if entry[0] != root_id]
    while pending:
        progress = False
        unresolved = []
        for entry in pending:
            row_id, parent, index, table, number, row = entry
            if parent not in paths:
                unresolved.append(entry)
                continue
            progress = True
            owner = nodes[parent]
            field = table['field']
            parent_entry = entries_by_id.get(parent)
            if not isinstance(owner, dict) or not parent_entry or parent_entry[3]['path'] != table['parent_path']:
                issue('invalid_parent', table['sheet'], number, 2, '父记录类型或所属子表不匹配', value=parent); continue
            path = f'{paths[parent]}.{field}'.lstrip('.')
            if table['array']:
                if not isinstance(owner.get(field), list) or isinstance(index, bool) or not isinstance(index, int) or index < 0:
                    issue('invalid_array_index', table['sheet'], number, 3, '父字段须为@array，顺序须为从0开始的整数'); continue
                key = (parent,field)
                slots = array_slots.setdefault(key,{})
                if index in slots:
                    issue('duplicate_array_index', table['sheet'], number, 3, '同一父记录的数组顺序重复'); continue
                slots[index] = nodes[row_id]
                paths[row_id] = f'{path}[{index}]'
            else:
                if (parent, field) in object_slots or owner.get(field) != {} or not isinstance(owner.get(field), dict):
                    issue('invalid_object_parent', table['sheet'], number, 2, '父字段须为@object，且子对象只能有一行'); continue
                object_slots.add((parent, field))
                owner[field] = nodes[row_id]; paths[row_id] = path
        pending = unresolved
        if not progress:
            for row_id,parent,_,table,number,_ in pending:
                issue('missing_parent', table['sheet'], number, 2, '父记录不存在或关联形成循环', value=parent)
            break
    for (parent,field), slots in array_slots.items():
        if sorted(slots) != list(range(len(slots))):
            issue('noncontiguous_array_index', EXTRAS, 1, 3, '数组顺序必须从0开始且连续', paths[parent]+'.'+field)
        else: nodes[parent][field].extend(slots[index] for index in sorted(slots))
    pending = extra_entries[:]
    extra_arrays = {}
    while pending:
        progress = False
        unresolved = []
        for row_id,parent,key,number in pending:
            if parent not in paths:
                unresolved.append((row_id,parent,key,number))
                continue
            progress=True
            owner = nodes[parent]
            if isinstance(owner, dict) and isinstance(key,str) and key and key not in owner:
                owner[key]=nodes[row_id]; paths[row_id]=(paths[parent]+'.'+key).lstrip('.')
            elif isinstance(owner,list) and isinstance(key,int) and not isinstance(key,bool) and key>=0:
                slots=extra_arrays.setdefault(parent,{})
                if key in slots: issue('duplicate_array_index',EXTRAS,number,3,'扩展数组序号重复'); continue
                slots[key]=nodes[row_id];paths[row_id]=f'{paths[parent]}[{key}]'
            else:
                issue('invalid_extension_key',EXTRAS,number,3,'扩展字段重复、类型不符或父对象不存在',value=key)
            if row_id in paths:
                locations[paths[row_id]]={'sheet':EXTRAS,'row':number,'column':5,'field':str(key),'reference_value':nodes[row_id]}
        pending = unresolved
        if not progress:
            for _,parent,_,number in pending: issue('missing_parent',EXTRAS,number,2,'父记录不存在或关联形成循环',value=parent)
            break
    for parent,slots in extra_arrays.items():
        if sorted(slots)!=list(range(len(slots))): issue('noncontiguous_array_index',EXTRAS,1,3,'扩展数组顺序不连续')
        else: nodes[parent].extend(slots[i] for i in sorted(slots))
    for row_id,_,_,table,number,row in attachments:
        if row_id not in paths: continue
        path=paths[row_id]
        locations[path]={'sheet':table['sheet'],'row':number,'column':1,'field':path,'reference_value':row_id}
        for column,name in enumerate(table['properties'],6):
            locations[(path+'.'+name).lstrip('.')]={'sheet':table['sheet'],'row':number,'column':column,'field':name,'reference_value':nodes[row_id].get(name) if isinstance(nodes[row_id],dict) else None}
    return nodes[root_id], locations, errors
