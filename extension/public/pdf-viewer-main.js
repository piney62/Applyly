chrome.runtime.sendMessage({ type: 'GET_PDF' }, function(response) {
  var st = document.getElementById('status')
  var data = response && response.pdf_base64

  if (!data) {
    st.textContent = 'PDF not available.\n\nPDF generation requires Microsoft Word or LibreOffice on the backend server.\n\nYour tailored DOCX resume has been saved and will be used when you apply.'
    return
  }

  try {
    var bytes = Uint8Array.from(atob(data), function(c) { return c.charCodeAt(0) })
    var blob = new Blob([bytes], { type: 'application/pdf' })
    var url = URL.createObjectURL(blob)
    st.remove()
    var embed = document.createElement('embed')
    embed.type = 'application/pdf'
    embed.src = url
    embed.setAttribute('width', '100%')
    embed.setAttribute('height', '100%')
    document.body.appendChild(embed)
  } catch(e) {
    st.textContent = 'Error rendering PDF: ' + e.message
  }
})
