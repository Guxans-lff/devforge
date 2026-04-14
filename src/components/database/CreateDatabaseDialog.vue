<script setup lang="ts">
import { ref, watch } from 'vue'
import { parseBackendError } from '@/types/error'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Database, Loader2 } from 'lucide-vue-next'
import * as dbApi from '@/api/database'

const props = defineProps<{
  connectionId: string
  open: boolean
}>()

const emit = defineEmits<{
  'update:open': [val: boolean]
  'success': [databaseName: string]
}>()

const databaseName = ref('')
const charset = ref('utf8mb4')
const collation = ref('utf8mb4_general_ci')
const isCreating = ref(false)
const error = ref('')

// Comprehensive charsets and collations for MySQL (Enterprise Level)
const charsetOptions = [
  { label: '默认 (Default)', value: 'default' },
  { label: 'utf8mb4 (推荐)', value: 'utf8mb4' },
  { label: 'utf8', value: 'utf8' },
  { label: 'utf8mb3', value: 'utf8mb3' },
  { label: 'latin1', value: 'latin1' },
  { label: 'ascii', value: 'ascii' },
  { label: 'armscii8', value: 'armscii8' },
  { label: 'big5', value: 'big5' },
  { label: 'binary', value: 'binary' },
  { label: 'cp1250', value: 'cp1250' },
  { label: 'cp1251', value: 'cp1251' },
  { label: 'cp1256', value: 'cp1256' },
  { label: 'cp1257', value: 'cp1257' },
  { label: 'cp850', value: 'cp850' },
  { label: 'cp852', value: 'cp852' },
  { label: 'cp866', value: 'cp866' },
  { label: 'cp932', value: 'cp932' },
  { label: 'dec8', value: 'dec8' },
  { label: 'eucjpms', value: 'eucjpms' },
  { label: 'euckr', value: 'euckr' },
  { label: 'gb18030', value: 'gb18030' },
  { label: 'gb2312', value: 'gb2312' },
  { label: 'gbk', value: 'gbk' },
  { label: 'geostd8', value: 'geostd8' },
  { label: 'greek', value: 'greek' },
  { label: 'hebrew', value: 'hebrew' },
  { label: 'hp8', value: 'hp8' },
  { label: 'keybcs2', value: 'keybcs2' },
  { label: 'koi8r', value: 'koi8r' },
  { label: 'koi8u', value: 'koi8u' },
  { label: 'latin2', value: 'latin2' },
  { label: 'latin5', value: 'latin5' },
  { label: 'latin7', value: 'latin7' },
  { label: 'macce', value: 'macce' },
  { label: 'macroman', value: 'macroman' },
  { label: 'sjis', value: 'sjis' },
  { label: 'swe7', value: 'swe7' },
  { label: 'tis620', value: 'tis620' },
  { label: 'ucs2', value: 'ucs2' },
  { label: 'ujis', value: 'ujis' },
  { label: 'utf16', value: 'utf16' },
  { label: 'utf16le', value: 'utf16le' },
  { label: 'utf32', value: 'utf32' }
]

const collationMap: Record<string, { label: string, value: string }[]> = {
  default: [{ label: '默认 (Default)', value: 'default' }],
  utf8mb4: [
    { label: '默认 (Default)', value: 'default' },
    { label: 'utf8mb4_general_ci (推荐)', value: 'utf8mb4_general_ci' },
    { label: 'utf8mb4_0900_ai_ci', value: 'utf8mb4_0900_ai_ci' },
    { label: 'utf8mb4_0900_as_ci', value: 'utf8mb4_0900_as_ci' },
    { label: 'utf8mb4_0900_as_cs', value: 'utf8mb4_0900_as_cs' },
    { label: 'utf8mb4_0900_bin', value: 'utf8mb4_0900_bin' },
    { label: 'utf8mb4_bin', value: 'utf8mb4_bin' },
    { label: 'utf8mb4_croatian_ci', value: 'utf8mb4_croatian_ci' },
    { label: 'utf8mb4_cs_0900_ai_ci', value: 'utf8mb4_cs_0900_ai_ci' },
    { label: 'utf8mb4_cs_0900_as_cs', value: 'utf8mb4_cs_0900_as_cs' },
    { label: 'utf8mb4_da_0900_ai_ci', value: 'utf8mb4_da_0900_ai_ci' },
    { label: 'utf8mb4_da_0900_as_cs', value: 'utf8mb4_da_0900_as_cs' },
    { label: 'utf8mb4_de_pb_0900_ai_ci', value: 'utf8mb4_de_pb_0900_ai_ci' },
    { label: 'utf8mb4_de_pb_0900_as_cs', value: 'utf8mb4_de_pb_0900_as_cs' },
    { label: 'utf8mb4_eo_0900_ai_ci', value: 'utf8mb4_eo_0900_ai_ci' },
    { label: 'utf8mb4_eo_0900_as_cs', value: 'utf8mb4_eo_0900_as_cs' },
    { label: 'utf8mb4_es_0900_ai_ci', value: 'utf8mb4_es_0900_ai_ci' },
    { label: 'utf8mb4_es_0900_as_cs', value: 'utf8mb4_es_0900_as_cs' },
    { label: 'utf8mb4_es_trad_0900_ai_ci', value: 'utf8mb4_es_trad_0900_ai_ci' },
    { label: 'utf8mb4_es_trad_0900_as_cs', value: 'utf8mb4_es_trad_0900_as_cs' },
    { label: 'utf8mb4_estonian_ci', value: 'utf8mb4_estonian_ci' },
    { label: 'utf8mb4_expect_0900_ai_ci', value: 'utf8mb4_expect_0900_ai_ci' },
    { label: 'utf8mb4_expect_0900_as_cs', value: 'utf8mb4_expect_0900_as_cs' },
    { label: 'utf8mb4_general_ci (推荐)', value: 'utf8mb4_general_ci' },
    { label: 'utf8mb4_german2_ci', value: 'utf8mb4_german2_ci' },
    { label: 'utf8mb4_hr_0900_ai_ci', value: 'utf8mb4_hr_0900_ai_ci' },
    { label: 'utf8mb4_hr_0900_as_cs', value: 'utf8mb4_hr_0900_as_cs' },
    { label: 'utf8mb4_hu_0900_ai_ci', value: 'utf8mb4_hu_0900_ai_ci' },
    { label: 'utf8mb4_hu_0900_as_cs', value: 'utf8mb4_hu_0900_as_cs' },
    { label: 'utf8mb4_icelandic_ci', value: 'utf8mb4_icelandic_ci' },
    { label: 'utf8mb4_is_0900_ai_ci', value: 'utf8mb4_is_0900_ai_ci' },
    { label: 'utf8mb4_is_0900_as_cs', value: 'utf8mb4_is_0900_as_cs' },
    { label: 'utf8mb4_ja_0900_as_cs', value: 'utf8mb4_ja_0900_as_cs' },
    { label: 'utf8mb4_ja_0900_as_cs_ks', value: 'utf8mb4_ja_0900_as_cs_ks' },
    { label: 'utf8mb4_latvian_ci', value: 'utf8mb4_latvian_ci' },
    { label: 'utf8mb4_lt_0900_ai_ci', value: 'utf8mb4_lt_0900_ai_ci' },
    { label: 'utf8mb4_lt_0900_as_cs', value: 'utf8mb4_lt_0900_as_cs' },
    { label: 'utf8mb4_lv_0900_ai_ci', value: 'utf8mb4_lv_0900_ai_ci' },
    { label: 'utf8mb4_lv_0900_as_cs', value: 'utf8mb4_lv_0900_as_cs' },
    { label: 'utf8mb4_persian_ci', value: 'utf8mb4_persian_ci' },
    { label: 'utf8mb4_pl_0900_ai_ci', value: 'utf8mb4_pl_0900_ai_ci' },
    { label: 'utf8mb4_pl_0900_as_cs', value: 'utf8mb4_pl_0900_as_cs' },
    { label: 'utf8mb4_polish_ci', value: 'utf8mb4_polish_ci' },
    { label: 'utf8mb4_ro_0900_ai_ci', value: 'utf8mb4_ro_0900_ai_ci' },
    { label: 'utf8mb4_ro_0900_as_cs', value: 'utf8mb4_ro_0900_as_cs' },
    { label: 'utf8mb4_romanian_ci', value: 'utf8mb4_romanian_ci' },
    { label: 'utf8mb4_ru_0900_ai_ci', value: 'utf8mb4_ru_0900_ai_ci' },
    { label: 'utf8mb4_ru_0900_as_cs', value: 'utf8mb4_ru_0900_as_cs' },
    { label: 'utf8mb4_sk_0900_ai_ci', value: 'utf8mb4_sk_0900_ai_ci' },
    { label: 'utf8mb4_sk_0900_as_cs', value: 'utf8mb4_sk_0900_as_cs' },
    { label: 'utf8mb4_sl_0900_ai_ci', value: 'utf8mb4_sl_0900_ai_ci' },
    { label: 'utf8mb4_sl_0900_as_cs', value: 'utf8mb4_sl_0900_as_cs' },
    { label: 'utf8mb4_slovak_ci', value: 'utf8mb4_slovak_ci' },
    { label: 'utf8mb4_slovenian_ci', value: 'utf8mb4_slovenian_ci' },
    { label: 'utf8mb4_spanish2_ci', value: 'utf8mb4_spanish2_ci' },
    { label: 'utf8mb4_spanish_ci', value: 'utf8mb4_spanish_ci' },
    { label: 'utf8mb4_sv_0900_ai_ci', value: 'utf8mb4_sv_0900_ai_ci' },
    { label: 'utf8mb4_sv_0900_as_cs', value: 'utf8mb4_sv_0900_as_cs' },
    { label: 'utf8mb4_swedish_ci', value: 'utf8mb4_swedish_ci' },
    { label: 'utf8mb4_tr_0900_ai_ci', value: 'utf8mb4_tr_0900_ai_ci' },
    { label: 'utf8mb4_tr_0900_as_cs', value: 'utf8mb4_tr_0900_as_cs' },
    { label: 'utf8mb4_turkish_ci', value: 'utf8mb4_turkish_ci' },
    { label: 'utf8mb4_unicode_520_ci', value: 'utf8mb4_unicode_520_ci' },
    { label: 'utf8mb4_unicode_ci', value: 'utf8mb4_unicode_ci' },
    { label: 'utf8mb4_vi_0900_ai_ci', value: 'utf8mb4_vi_0900_ai_ci' },
    { label: 'utf8mb4_vi_0900_as_cs', value: 'utf8mb4_vi_0900_as_cs' },
    { label: 'utf8mb4_zh_0900_as_cs', value: 'utf8mb4_zh_0900_as_cs' }
  ],
  utf8: [
    { label: '默认 (Default)', value: 'default' },
    { label: 'utf8_general_ci', value: 'utf8_general_ci' },
    { label: 'utf8_unicode_ci', value: 'utf8_unicode_ci' },
    { label: 'utf8_bin', value: 'utf8_bin' },
    { label: 'utf8_croatian_ci', value: 'utf8_croatian_ci' },
    { label: 'utf8_czech_ci', value: 'utf8_czech_ci' },
    { label: 'utf8_danish_ci', value: 'utf8_danish_ci' },
    { label: 'utf8_esperanto_ci', value: 'utf8_esperanto_ci' },
    { label: 'utf8_estonian_ci', value: 'utf8_estonian_ci' },
    { label: 'utf8_general_mysql500_ci', value: 'utf8_general_mysql500_ci' },
    { label: 'utf8_german2_ci', value: 'utf8_german2_ci' },
    { label: 'utf8_hungarian_ci', value: 'utf8_hungarian_ci' },
    { label: 'utf8_icelandic_ci', value: 'utf8_icelandic_ci' },
    { label: 'utf8_latvian_ci', value: 'utf8_latvian_ci' },
    { label: 'utf8_lithuanian_ci', value: 'utf8_lithuanian_ci' },
    { label: 'utf8_persian_ci', value: 'utf8_persian_ci' },
    { label: 'utf8_polish_ci', value: 'utf8_polish_ci' },
    { label: 'utf8_romanian_ci', value: 'utf8_romanian_ci' },
    { label: 'utf8_roman_ci', value: 'utf8_roman_ci' },
    { label: 'utf8_sinhala_ci', value: 'utf8_sinhala_ci' },
    { label: 'utf8_slovak_ci', value: 'utf8_slovak_ci' },
    { label: 'utf8_slovenian_ci', value: 'utf8_slovenian_ci' },
    { label: 'utf8_spanish2_ci', value: 'utf8_spanish2_ci' },
    { label: 'utf8_spanish_ci', value: 'utf8_spanish_ci' },
    { label: 'utf8_swedish_ci', value: 'utf8_swedish_ci' },
    { label: 'utf8_tolower_ci', value: 'utf8_tolower_ci' },
    { label: 'utf8_turkish_ci', value: 'utf8_turkish_ci' },
    { label: 'utf8_unicode_520_ci', value: 'utf8_unicode_520_ci' },
    { label: 'utf8_vietnamese_ci', value: 'utf8_vietnamese_ci' }
  ],
  utf8mb3: [
    { label: '默认 (Default)', value: 'default' },
    { label: 'utf8mb3_general_ci', value: 'utf8mb3_general_ci' },
    { label: 'utf8mb3_unicode_ci', value: 'utf8mb3_unicode_ci' },
    { label: 'utf8mb3_bin', value: 'utf8mb3_bin' },
    { label: 'utf8mb3_chinese_ci', value: 'utf8mb3_chinese_ci' }
  ],
  latin1: [
    { label: '默认 (Default)', value: 'default' },
    { label: 'latin1_swedish_ci', value: 'latin1_swedish_ci' },
    { label: 'latin1_general_ci', value: 'latin1_general_ci' },
    { label: 'latin1_general_cs', value: 'latin1_general_cs' },
    { label: 'latin1_bin', value: 'latin1_bin' },
    { label: 'latin1_german1_ci', value: 'latin1_german1_ci' },
    { label: 'latin1_german2_ci', value: 'latin1_german2_ci' },
    { label: 'latin1_danish_ci', value: 'latin1_danish_ci' },
    { label: 'latin1_spanish_ci', value: 'latin1_spanish_ci' }
  ],
  ascii: [
    { label: '默认 (Default)', value: 'default' },
    { label: 'ascii_general_ci', value: 'ascii_general_ci' },
    { label: 'ascii_bin', value: 'ascii_bin' }
  ],
  gbk: [
    { label: '默认 (Default)', value: 'default' },
    { label: 'gbk_chinese_ci', value: 'gbk_chinese_ci' },
    { label: 'gbk_bin', value: 'gbk_bin' }
  ],
  gb2312: [
    { label: '默认 (Default)', value: 'default' },
    { label: 'gb2312_chinese_ci', value: 'gb2312_chinese_ci' },
    { label: 'gb2312_bin', value: 'gb2312_bin' }
  ],
  big5: [
    { label: '默认 (Default)', value: 'default' },
    { label: 'big5_chinese_ci', value: 'big5_chinese_ci' },
    { label: 'big5_bin', value: 'big5_bin' }
  ],
  gb18030: [
    { label: '默认 (Default)', value: 'default' },
    { label: 'gb18030_chinese_ci', value: 'gb18030_chinese_ci' },
    { label: 'gb18030_bin', value: 'gb18030_bin' },
    { label: 'gb18030_unicode_520_ci', value: 'gb18030_unicode_520_ci' }
  ],
  armscii8: [
    { label: '默认 (Default)', value: 'default' },
    { label: 'armscii8_general_ci', value: 'armscii8_general_ci' },
    { label: 'armscii8_bin', value: 'armscii8_bin' }
  ],
  cp1250: [
    { label: '默认 (Default)', value: 'default' },
    { label: 'cp1250_general_ci', value: 'cp1250_general_ci' },
    { label: 'cp1250_czech_cs', value: 'cp1250_czech_cs' },
    { label: 'cp1250_croatian_ci', value: 'cp1250_croatian_ci' },
    { label: 'cp1250_bin', value: 'cp1250_bin' },
    { label: 'cp1250_polish_ci', value: 'cp1250_polish_ci' }
  ]
}

watch(charset, (val) => {
  // 切换字符集时重置排序规则为该字符集的推荐默认值
  collation.value = val === 'utf8mb4' ? 'utf8mb4_general_ci' : 'default'
})

watch(() => props.open, (val) => {
  if (val) {
    databaseName.value = ''
    charset.value = 'utf8mb4'
    collation.value = 'utf8mb4_general_ci'
    error.value = ''
    isCreating.value = false
  }
})

async function handleCreate() {
  const name = databaseName.value.trim()
  if (!name) {
    error.value = '数据库名称不能为空'
    return
  }

  isCreating.value = true
  error.value = ''

  try {
    let sql = `CREATE DATABASE \`${name}\``
    if (charset.value !== 'default') {
      sql += ` CHARACTER SET ${charset.value}`
    }
    if (collation.value !== 'default') {
      sql += ` COLLATE ${collation.value}`
    }

    await dbApi.dbExecuteQuery(props.connectionId, sql)
    emit('success', name)
    emit('update:open', false)
  } catch (e: unknown) {
    error.value = parseBackendError(e).message
  } finally {
    isCreating.value = false
  }
}
</script>

<template>
  <Dialog :open="open" @update:open="(val) => !isCreating && emit('update:open', val)">
    <DialogContent class="sm:max-w-[480px] p-0 overflow-hidden bg-background/95 backdrop-blur-xl border-border/40 shadow-2xl">
      <DialogHeader class="px-6 py-5 border-b border-border/20 bg-gradient-to-r from-primary/5 to-transparent">
        <DialogTitle class="flex items-center gap-3 text-lg">
          <div class="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 ring-1 ring-primary/20">
            <Database class="w-4 h-4 text-primary" />
          </div>
          新建数据库
        </DialogTitle>
      </DialogHeader>

      <div class="px-6 py-6 space-y-6">
        <!-- 数据库名称输入 -->
        <div class="space-y-2">
          <Label htmlFor="databaseName" class="text-sm font-medium text-foreground/80 flex items-center justify-between">
            数据库名称
            <span class="text-xs font-normal text-muted-foreground">必填</span>
          </Label>
          <Input
            id="databaseName"
            v-model="databaseName"
            placeholder="请输入数据库名称，例如: my_db"
            class="w-full bg-muted/20 border-border/40 focus-visible:ring-1 focus-visible:ring-primary/50 transition-[border-color,box-shadow] h-10"
            @keyup.enter="handleCreate"
            :disabled="isCreating"
            autofocus
            autocomplete="off"
            spellcheck="false"
          />
        </div>
        
        <div class="grid grid-cols-2 gap-4">
          <!-- 字符集 -->
          <div class="space-y-2">
            <Label class="text-sm font-medium text-foreground/80">
              字符集 (Charset)
            </Label>
            <Select v-model="charset" :disabled="isCreating">
              <SelectTrigger class="w-full bg-muted/20 border-border/40 focus:ring-1 focus:ring-primary/50 transition-[border-color,box-shadow] h-10">
                <SelectValue placeholder="选择字符集" />
              </SelectTrigger>
              <SelectContent position="popper" align="start" side="bottom" class="max-h-[250px] w-[200px]">
                <SelectItem v-for="item in charsetOptions" :key="item.value" :value="item.value">
                  {{ item.label }}
                </SelectItem>
              </SelectContent>
            </Select>
          </div>

          <!-- 排序规则 -->
          <div class="space-y-2">
            <Label class="text-sm font-medium text-foreground/80">
              排序规则 (Collation)
            </Label>
            <Select v-model="collation" :disabled="isCreating">
              <SelectTrigger class="w-full bg-muted/20 border-border/40 focus:ring-1 focus:ring-primary/50 transition-[border-color,box-shadow] h-10">
                <SelectValue placeholder="选择排序规则" />
              </SelectTrigger>
              <SelectContent position="popper" align="start" side="bottom" class="max-h-[250px] w-[220px]">
                <SelectItem v-for="item in collationMap[charset] || collationMap['default']" :key="item.value" :value="item.value">
                  {{ item.label }}
                </SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <p v-if="error" class="text-sm font-medium text-destructive mt-2">{{ error }}</p>
      </div>

      <div class="px-6 py-4 border-t border-border/20 bg-muted/10 flex justify-end gap-3">
        <Button variant="outline" :disabled="isCreating" @click="emit('update:open', false)" class="shadow-sm">
          取消
        </Button>
        <Button variant="default" :disabled="isCreating || !databaseName.trim()" @click="handleCreate" class="min-w-[90px] shadow-sm">
          <Loader2 v-if="isCreating" class="w-4 h-4 mr-2 animate-spin" />
          确认创建
        </Button>
      </div>
    </DialogContent>
  </Dialog>
</template>
