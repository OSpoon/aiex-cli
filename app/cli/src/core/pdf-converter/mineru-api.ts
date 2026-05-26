import type { MineruApiPdfConverterConfig, PdfConversionResult, PdfConverter } from '@/types'
import { Buffer } from 'node:buffer'
import path from 'node:path'
import process from 'node:process'
import AdmZip from 'adm-zip'
import { consola } from 'consola'
import { t } from '@/locales'

const TRAILING_SLASH_REGEXP = /\/+$/

export class MineruApiPdfConverter implements PdfConverter {
  readonly name = 'mineru_api'

  constructor(
    private readonly config: MineruApiPdfConverterConfig,
  ) {}

  async convert(input: Uint8Array, filePath?: string): Promise<PdfConversionResult> {
    const token = this.config.token?.trim()
    if (!token) {
      throw new Error(t('errors.pdf.mineruApiTokenRequired'))
    }

    const baseURL = (this.config.baseURL || 'https://mineru.net/api/v4').replace(TRAILING_SLASH_REGEXP, '')
    const modelVersion = this.config.modelVersion || 'vlm'
    const isOcr = this.config.isOcr ?? true
    const enableFormula = this.config.enableFormula ?? true
    const enableTable = this.config.enableTable ?? true

    // File name
    const fileName = filePath ? path.basename(filePath) : 'document.pdf'

    // Step 1: Request presigned upload URL
    consola.info('Requesting Mineru upload URL...')
    const requestUrl = `${baseURL}/file-urls/batch`
    const requestPayload = {
      files: [
        {
          name: fileName,
          data_id: `aiex_${Date.now()}`,
        },
      ],
      model_version: modelVersion,
      is_ocr: isOcr,
      enable_formula: enableFormula,
      enable_table: enableTable,
    }

    const response = await fetch(requestUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestPayload),
    })

    if (!response.ok) {
      const text = await response.text().catch(() => '')
      throw new Error(`Failed to request upload URL: ${response.status} ${response.statusText} ${text}`)
    }

    const resJson = await response.json() as any
    if (resJson.code !== 0) {
      throw new Error(`Mineru API error (file-urls/batch): ${resJson.msg || JSON.stringify(resJson)}`)
    }

    const batchId = resJson.data?.batch_id
    let uploadUrl = ''

    if (resJson.data?.file_urls && resJson.data.file_urls.length > 0) {
      uploadUrl = resJson.data.file_urls[0]
    }
    else if (resJson.data?.file_upload_urls && resJson.data.file_upload_urls.length > 0) {
      uploadUrl = resJson.data.file_upload_urls[0].upload_url
    }

    if (!uploadUrl || !batchId) {
      throw new Error(`Mineru API did not return upload URLs or batch ID: ${JSON.stringify(resJson)}`)
    }

    // Step 2: Upload file via PUT
    consola.info(`Uploading file to Mineru storage (${(input.byteLength / 1024 / 1024).toFixed(2)} MB)...`)

    const uploadResponse = await fetch(uploadUrl, {
      method: 'PUT',
      body: input,
      // CRITICAL: Do NOT set Content-Type or other headers
    })

    if (!uploadResponse.ok) {
      const text = await uploadResponse.text().catch(() => '')
      throw new Error(`Failed to upload file to OSS: ${uploadResponse.status} ${uploadResponse.statusText} ${text}`)
    }

    // Step 3: Poll status
    consola.info(`Mineru task started, polling results (batch_id: ${batchId})...`)
    const statusUrl = `${baseURL}/extract-results/batch/${batchId}`

    const maxPollAttempts = 120 // 10 minutes max
    const pollIntervalMs = process.env.NODE_ENV === 'test' ? 1 : 5000 // 5 seconds
    let attempts = 0
    let zipUrl = ''
    let totalPages = 1

    while (attempts < maxPollAttempts) {
      attempts++
      await new Promise(resolve => setTimeout(resolve, pollIntervalMs))

      const pollResponse = await fetch(statusUrl, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${token}`,
        },
      })

      if (!pollResponse.ok) {
        consola.warn(`Poll request failed: ${pollResponse.statusText}. Retrying...`)
        continue
      }

      const pollJson = await pollResponse.json() as any
      if (pollJson.code !== 0) {
        throw new Error(`Mineru API poll error: ${pollJson.msg || JSON.stringify(pollJson)}`)
      }

      const extractResultList = pollJson.data?.extract_result
      if (!extractResultList || !extractResultList.length) {
        throw new Error(`Mineru API did not return extraction results: ${JSON.stringify(pollJson)}`)
      }

      const result = extractResultList[0]
      const state = result.state

      consola.info(`Mineru parsing state: ${state} (attempt ${attempts}/${maxPollAttempts})`)

      if (state === 'done') {
        zipUrl = result.full_zip_url
        if (result.extract_progress?.total_pages) {
          totalPages = result.extract_progress.total_pages
        }
        break
      }

      if (state === 'failed') {
        throw new Error(`Mineru extraction failed: ${result.err_msg || 'Unknown error'}`)
      }
    }

    if (!zipUrl) {
      throw new Error(`Mineru extraction timed out after ${maxPollAttempts * pollIntervalMs / 1000} seconds`)
    }

    // Step 4: Download result ZIP and extract Markdown
    consola.info('Downloading result ZIP from Mineru...')
    const zipResponse = await fetch(zipUrl)
    if (!zipResponse.ok) {
      throw new Error(`Failed to download result zip: ${zipResponse.statusText}`)
    }

    const arrayBuffer = await zipResponse.arrayBuffer()
    const zipBuffer = Buffer.from(arrayBuffer)

    consola.info('Extracting Markdown content...')
    const zip = new AdmZip(zipBuffer)
    const entries = zip.getEntries()

    // Find full.md or any md file
    let mdEntry = entries.find(e => e.entryName === 'full.md' || e.entryName.endsWith('full.md'))
    if (!mdEntry) {
      mdEntry = entries.find(e => e.entryName.endsWith('.md'))
    }

    if (!mdEntry) {
      throw new Error('Could not find any Markdown (.md) file inside the Mineru result zip')
    }

    const textContent = mdEntry.getData().toString('utf8')

    return {
      text: textContent,
      pageCount: totalPages,
    }
  }
}
