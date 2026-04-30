chrome.runtime.sendMessage({ type: 'GET_PDF' }, (response) => {
  const st = document.getElementById('status')!
  const data: string | null = response?.pdf_base64 ?? null

  if (!data) {
    st.textContent =
      'PDF not available.\n\nPDF generation requires Microsoft Word or LibreOffice on the backend server.\n\nYour tailored DOCX resume has been saved and will be used when you apply.'
    return
  }

  try {
    const bytes = Uint8Array.from(atob(data), (c) => c.charCodeAt(0))
    const blob = new Blob([bytes], { type: 'application/pdf' })
    const url = URL.createObjectURL(blob)
    st.remove()
    const embed = document.createElement('embed')
    embed.type = 'application/pdf'
    embed.src = url
    embed.setAttribute('width', '100%')
    embed.setAttribute('height', '100%')
    document.body.appendChild(embed)
  } catch (e) {
    st.textContent = 'Error rendering PDF: ' + (e instanceof Error ? e.message : String(e))
  }
})
