'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import {
  FlaskConical,
  Plus,
  Trash2,
  Loader2,
  CheckCircle,
  AlertTriangle,
  DollarSign,
  FileText,
  Sparkles,
} from 'lucide-react'

interface LineItem {
  name: string
  code: string
  quantity: number
  unitPrice: number
}

interface InvoiceLine {
  service: string
  code: string
  quantity: number
  unit_price: number
  total: number
}

interface TestResult {
  pricingAnalysis: {
    adjustments: Array<{
      type: string
      value: number
      reason: string
      appliesToAll: boolean
      serviceIndex?: number
    }>
    summary: string
  }
  invoice: {
    line_items: InvoiceLine[]
    subtotal: number
    tax_rate: number
    tax_amount: number
    total_amount: number
  }
  report: {
    title: string
    summary: string
    work_performed: string[]
    findings: string[]
    recommendations: string[]
  }
}

export default function TestAIPage() {
  const [lineItems, setLineItems] = useState<LineItem[]>([
    { name: 'Basin/Kitchen Sink Line Clearing', code: 'BASIN-SINK', quantity: 1, unitPrice: 150 },
  ])
  const [techNotes, setTechNotes] = useState('')
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<TestResult | null>(null)
  const [error, setError] = useState<string | null>(null)

  const addLineItem = () => {
    setLineItems([...lineItems, { name: '', code: '', quantity: 1, unitPrice: 0 }])
  }

  const removeLineItem = (idx: number) => {
    setLineItems(lineItems.filter((_, i) => i !== idx))
  }

  const updateLineItem = (idx: number, field: keyof LineItem, value: string | number) => {
    const updated = [...lineItems]
    if (field === 'quantity' || field === 'unitPrice') {
      updated[idx][field] = Number(value) || 0
    } else {
      updated[idx][field] = value as string
    }
    setLineItems(updated)
  }

  const runTest = async () => {
    setLoading(true)
    setError(null)
    setResult(null)

    try {
      const res = await fetch('/api/test-ai', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ techNotes, lineItems }),
      })

      const data = await res.json()

      if (!res.ok) {
        setError(data.error || 'Something went wrong')
        return
      }

      setResult(data)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Network error')
    } finally {
      setLoading(false)
    }
  }

  const resetAll = () => {
    setResult(null)
    setError(null)
    setTechNotes('')
    setLineItems([{ name: 'Basin/Kitchen Sink Line Clearing', code: 'BASIN-SINK', quantity: 1, unitPrice: 150 }])
  }

  const itemsSubtotal = lineItems.reduce((sum, li) => sum + li.quantity * li.unitPrice, 0)

  return (
    <div className="p-4 md:p-6 max-w-4xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="h-10 w-10 rounded-lg bg-purple-100 flex items-center justify-center">
          <FlaskConical className="h-5 w-5 text-purple-600" />
        </div>
        <div>
          <h1 className="text-xl md:text-2xl font-bold">AI Sandbox</h1>
          <p className="text-sm text-muted-foreground">
            Test how the AI reads tech notes and generates invoices + reports. Nothing is saved.
          </p>
        </div>
      </div>

      <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 flex items-start gap-2">
        <AlertTriangle className="h-4 w-4 text-amber-600 mt-0.5 shrink-0" />
        <p className="text-sm text-amber-800">
          This is a sandbox — no jobs, invoices, or reports are created. It just shows you what the AI <em>would</em> do.
        </p>
      </div>

      {/* Services Section */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <DollarSign className="h-4 w-4" />
            Services (simulate what the tech selected)
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {lineItems.map((item, idx) => (
            <div key={idx} className="flex flex-col sm:flex-row gap-2 p-3 bg-muted/50 rounded-lg">
              <div className="flex-1 space-y-2 sm:space-y-0 sm:flex sm:gap-2">
                <Input
                  placeholder="Service name"
                  value={item.name}
                  onChange={(e) => updateLineItem(idx, 'name', e.target.value)}
                  className="sm:flex-1"
                />
                <Input
                  placeholder="Code"
                  value={item.code}
                  onChange={(e) => updateLineItem(idx, 'code', e.target.value)}
                  className="sm:w-28"
                />
                <Input
                  type="number"
                  placeholder="Qty"
                  value={item.quantity}
                  onChange={(e) => updateLineItem(idx, 'quantity', e.target.value)}
                  className="sm:w-20"
                  min={1}
                />
                <Input
                  type="number"
                  placeholder="Price"
                  value={item.unitPrice}
                  onChange={(e) => updateLineItem(idx, 'unitPrice', e.target.value)}
                  className="sm:w-28"
                  min={0}
                  step={0.01}
                />
              </div>
              <div className="flex items-center justify-between sm:justify-end gap-2">
                <span className="text-sm font-medium sm:w-20 text-right">
                  ${(item.quantity * item.unitPrice).toFixed(2)}
                </span>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 text-destructive"
                  onClick={() => removeLineItem(idx)}
                  disabled={lineItems.length <= 1}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            </div>
          ))}

          <div className="flex items-center justify-between">
            <Button variant="outline" size="sm" onClick={addLineItem}>
              <Plus className="h-4 w-4 mr-1" /> Add Service
            </Button>
            <span className="text-sm font-semibold">
              Subtotal: ${itemsSubtotal.toFixed(2)}
            </span>
          </div>
        </CardContent>
      </Card>

      {/* Tech Notes */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <FileText className="h-4 w-4" />
            Technician Notes
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Label className="text-sm text-muted-foreground mb-2 block">
            Write notes as a field tech would. Try including discounts, observations, or special instructions.
          </Label>
          <Textarea
            placeholder="e.g. client has a 50% discount. please add that discount to invoice. cleared the main line, found heavy grease buildup. recommended monthly maintenance."
            value={techNotes}
            onChange={(e) => setTechNotes(e.target.value)}
            rows={4}
          />
          <div className="mt-3 flex flex-wrap gap-2">
            <span className="text-xs text-muted-foreground">Try:</span>
            {[
              'client has a 50% discount. please add to invoice',
              'no charge — this was a warranty callback',
              'after hours emergency, add $75 surcharge',
              'everything went well, no issues found',
            ].map((example) => (
              <button
                key={example}
                className="text-xs px-2 py-1 rounded-full bg-muted hover:bg-muted/80 transition-colors text-left"
                onClick={() => setTechNotes(example)}
              >
                &ldquo;{example}&rdquo;
              </button>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Run Button */}
      <div className="flex gap-3">
        <Button
          onClick={runTest}
          disabled={loading || !techNotes.trim()}
          className="flex-1 sm:flex-none"
          size="lg"
        >
          {loading ? (
            <>
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              Running AI Pipeline...
            </>
          ) : (
            <>
              <Sparkles className="h-4 w-4 mr-2" />
              Test AI Pipeline
            </>
          )}
        </Button>
        {result && (
          <Button variant="outline" size="lg" onClick={resetAll}>
            Reset
          </Button>
        )}
      </div>

      {/* Error */}
      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4">
          <p className="text-sm text-red-800 font-medium">{error}</p>
        </div>
      )}

      {/* Results */}
      {result && (
        <div className="space-y-6">
          <div className="flex items-center gap-2 text-green-700">
            <CheckCircle className="h-5 w-5" />
            <span className="font-semibold">AI Pipeline Complete</span>
            <Badge variant="outline" className="text-xs">sandbox — nothing saved</Badge>
          </div>

          {/* Pricing Analysis */}
          <Card className={result.pricingAnalysis.adjustments?.length > 0 ? 'border-purple-200' : ''}>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-purple-500" />
                Step 1: Pricing Analysis
                {result.pricingAnalysis.adjustments?.length > 0 ? (
                  <Badge className="bg-purple-100 text-purple-700 text-xs">
                    {result.pricingAnalysis.adjustments.length} adjustment(s) found
                  </Badge>
                ) : (
                  <Badge variant="secondary" className="text-xs">no adjustments</Badge>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent>
              {result.pricingAnalysis.adjustments?.length > 0 ? (
                <div className="space-y-2">
                  <p className="text-sm text-muted-foreground">{result.pricingAnalysis.summary}</p>
                  {result.pricingAnalysis.adjustments.map((adj, i) => (
                    <div key={i} className="flex items-center gap-2 p-2 bg-purple-50 rounded text-sm">
                      <Badge variant="outline" className="text-xs shrink-0">
                        {adj.type.replace('_', ' ')}
                      </Badge>
                      <span>{adj.reason}</span>
                      <span className="ml-auto font-mono font-medium">
                        {adj.type.includes('discount') || adj.type === 'waiver' ? '-' : '+'}
                        {adj.type.includes('percent') ? `${adj.value}%` : `$${adj.value}`}
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">
                  No pricing adjustments detected in the tech notes.
                </p>
              )}
            </CardContent>
          </Card>

          {/* Invoice Preview */}
          <Card className="border-green-200">
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <DollarSign className="h-4 w-4 text-green-600" />
                Step 2: Invoice Preview
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="border rounded-lg overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50">
                    <tr>
                      <th className="text-left p-2 font-medium">Service</th>
                      <th className="text-right p-2 font-medium w-16">Qty</th>
                      <th className="text-right p-2 font-medium w-24">Price</th>
                      <th className="text-right p-2 font-medium w-24">Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.invoice.line_items.map((li, i) => {
                      const isAdjustment = li.total < 0 || ['DISC', 'SRCH', 'WAIV'].includes(li.code)
                      return (
                        <tr
                          key={i}
                          className={isAdjustment ? 'bg-purple-50' : 'border-t'}
                        >
                          <td className={`p-2 ${isAdjustment ? 'text-purple-700 font-medium' : ''}`}>
                            {li.service}
                            {li.code && !isAdjustment && (
                              <span className="ml-2 text-xs text-muted-foreground">{li.code}</span>
                            )}
                          </td>
                          <td className="p-2 text-right">{isAdjustment ? '' : li.quantity}</td>
                          <td className="p-2 text-right font-mono">
                            {isAdjustment ? '' : `$${li.unit_price.toFixed(2)}`}
                          </td>
                          <td className={`p-2 text-right font-mono font-medium ${li.total < 0 ? 'text-red-600' : ''}`}>
                            {li.total < 0 ? `-$${Math.abs(li.total).toFixed(2)}` : `$${li.total.toFixed(2)}`}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                  <tfoot className="border-t-2">
                    <tr>
                      <td colSpan={3} className="p-2 text-right text-sm">Subtotal</td>
                      <td className="p-2 text-right font-mono font-medium">${result.invoice.subtotal.toFixed(2)}</td>
                    </tr>
                    <tr>
                      <td colSpan={3} className="p-2 text-right text-sm text-muted-foreground">
                        Tax ({result.invoice.tax_rate}%)
                      </td>
                      <td className="p-2 text-right font-mono text-muted-foreground">${result.invoice.tax_amount.toFixed(2)}</td>
                    </tr>
                    <tr className="bg-muted/50">
                      <td colSpan={3} className="p-2 text-right font-semibold">Total</td>
                      <td className="p-2 text-right font-mono font-bold text-lg">${result.invoice.total_amount.toFixed(2)}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </CardContent>
          </Card>

          {/* Report Preview */}
          <Card className="border-blue-200">
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <FileText className="h-4 w-4 text-blue-600" />
                Step 3: AI Report Preview
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4 text-sm">
              <div>
                <h4 className="font-semibold text-base mb-1">Summary</h4>
                <p className="text-muted-foreground">{result.report.summary}</p>
              </div>

              {result.report.work_performed?.length > 0 && (
                <div>
                  <h4 className="font-semibold mb-1">Work Performed</h4>
                  <ul className="list-disc list-inside space-y-1 text-muted-foreground">
                    {result.report.work_performed.map((item, i) => (
                      <li key={i}>{item}</li>
                    ))}
                  </ul>
                </div>
              )}

              {result.report.findings?.length > 0 && (
                <div>
                  <h4 className="font-semibold mb-1">Findings</h4>
                  <ul className="list-disc list-inside space-y-1 text-muted-foreground">
                    {result.report.findings.map((item, i) => (
                      <li key={i}>{item}</li>
                    ))}
                  </ul>
                </div>
              )}

              {result.report.recommendations?.length > 0 && (
                <div>
                  <h4 className="font-semibold mb-1">Recommendations</h4>
                  <ul className="list-disc list-inside space-y-1 text-muted-foreground">
                    {result.report.recommendations.map((item, i) => (
                      <li key={i}>{item}</li>
                    ))}
                  </ul>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  )
}
