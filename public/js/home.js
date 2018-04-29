/* global swal, axios, Dropzone, ClipboardJS, LazyLoad */

const page = {
  // user token
  token: localStorage.token,

  // configs from api/check
  private: null,
  enableUserAccounts: null,
  maxFileSize: null,
  chunkedUploads: null, // chunked uploads config

  // store album id that will be used with upload requests
  album: null,

  dropzone: null,
  clipboardJS: null,
  lazyLoad: null
}

const imageExtensions = ['.webp', '.jpg', '.jpeg', '.bmp', '.gif', '.png']

page.checkIfPublic = () => {
  axios.get('api/check')
    .then(response => {
      page.private = response.data.private
      page.enableUserAccounts = response.data.enableUserAccounts
      page.maxFileSize = response.data.maxFileSize
      page.chunkedUploads = response.data.chunkedUploads
      page.preparePage()
    })
    .catch(error => {
      console.log(error)
      const button = document.getElementById('loginToUpload')
      button.className = button.className.replace(' is-loading', '')
      button.innerText = 'Error occurred. Reload the page?'
      return swal('An error occurred!', 'There was an error with the request, please check the console for more information.', 'error')
    })
}

page.preparePage = () => {
  if (page.private) {
    if (page.token) {
      return page.verifyToken(page.token, true)
    } else {
      const button = document.getElementById('loginToUpload')
      button.href = 'auth'
      button.className = button.className.replace(' is-loading', '')

      if (page.enableUserAccounts) {
        button.innerText = 'Anonymous upload is disabled. Log in to page.'
      } else {
        button.innerText = 'Running in private mode. Log in to page.'
      }
    }
  } else {
    return page.prepareUpload()
  }
}

page.verifyToken = (token, reloadOnError) => {
  if (reloadOnError === undefined) { reloadOnError = false }

  axios.post('api/tokens/verify', { token })
    .then(response => {
      if (response.data.success === false) {
        swal({
          title: 'An error occurred!',
          text: response.data.description,
          icon: 'error'
        }).then(() => {
          if (reloadOnError) {
            localStorage.removeItem('token')
            location.reload()
          }
        })
        return
      }

      localStorage.token = token
      page.token = token
      return page.prepareUpload()
    })
    .catch(error => {
      console.log(error)
      return swal('An error occurred!', 'There was an error with the request, please check the console for more information.', 'error')
    })
}

page.prepareUpload = () => {
  // I think this fits best here because we need to check for a valid token before we can get the albums
  if (page.token) {
    const select = document.getElementById('albumSelect')

    select.addEventListener('change', () => {
      page.album = parseInt(select.value)
    })

    axios.get('api/albums', { headers: { token: page.token } })
      .then(res => {
        const albums = res.data.albums

        // If the user doesn't have any albums we don't really need to display
        // an album selection
        if (albums.length === 0) { return }

        // Loop through the albums and create an option for each album
        for (const album of albums) {
          const opt = document.createElement('option')
          opt.value = album.id
          opt.innerHTML = album.name
          select.appendChild(opt)
        }
        // Display the album selection
        document.getElementById('albumDiv').style.display = 'block'
      })
      .catch(error => {
        console.log(error)
        return swal('An error occurred!', 'There was an error with the request, please check the console for more information.', 'error')
      })
  }

  const div = document.createElement('div')
  div.id = 'dropzone'
  div.className = 'button is-unselectable'
  div.innerHTML = `
    <span class="icon">
      <i class="icon-upload-cloud"></i>
    </span>
    <span>Click here or drag and drop files</span>
  `
  div.style.display = 'flex'

  document.getElementById('maxFileSize').innerHTML = `Maximum upload size per file is ${page.maxFileSize}`
  document.getElementById('loginToUpload').style.display = 'none'

  if (!page.token && page.enableUserAccounts) {
    document.getElementById('loginLinkText').innerHTML = 'Create an account and keep track of your uploads'
  }

  document.getElementById('uploadContainer').appendChild(div)

  page.prepareDropzone()
}

page.prepareDropzone = () => {
  const previewNode = document.querySelector('#template')
  previewNode.id = ''
  const previewTemplate = previewNode.parentNode.innerHTML
  previewNode.parentNode.removeChild(previewNode)

  page.dropzone = new Dropzone('#dropzone', {
    url: 'api/upload',
    paramName: 'files[]',
    maxFilesize: parseInt(page.maxFileSize),
    parallelUploads: 2,
    uploadMultiple: false,
    previewsContainer: '#uploads',
    previewTemplate,
    createImageThumbnails: false,
    maxFiles: 1000,
    autoProcessQueue: true,
    headers: { token: page.token },
    chunking: page.chunkedUploads.enabled,
    chunkSize: parseInt(page.chunkedUploads.chunkSize) * 1000000, // 1000000 B = 1 MB,
    parallelChunkUploads: false, // when set to true, sometimes it often hangs with hundreds of parallel uploads
    chunksUploaded: async (file, done) => {
      file.previewElement.querySelector('.progress').setAttribute('value', 100)
      file.previewElement.querySelector('.progress').innerHTML = '100%'

      // The API supports an array of multiple files
      const response = await axios.post(
        'api/upload/finishchunks',
        {
          files: [{
            uuid: file.upload.uuid,
            original: file.name,
            size: file.size,
            type: file.type,
            count: file.upload.totalChunkCount,
            albumid: page.album
          }]
        },
        {
          headers: { token: page.token }
        })
        .then(response => response.data)
        .catch(error => {
          return {
            success: false,
            description: error.toString()
          }
        })

      file.previewTemplate.querySelector('.progress').style.display = 'none'

      if (response.success === false) {
        file.previewTemplate.querySelector('.error').innerHTML = response.description
      }

      if (response.files && response.files[0]) {
        page.updateTemplate(file, response.files[0])
      }
      return done()
    }
  })

  page.dropzone.on('addedfile', file => {
    document.getElementById('uploads').style.display = 'block'
  })

  // Add the selected albumid, if an album is selected, as a header
  page.dropzone.on('sending', (file, xhr, formData) => {
    if (file.upload.chunked) { return }
    if (page.album) { xhr.setRequestHeader('albumid', page.album) }
  })

  // Update the total progress bar
  page.dropzone.on('uploadprogress', (file, progress, bytesSent) => {
    if (file.upload.chunked && progress === 100) { return }
    file.previewElement.querySelector('.progress').setAttribute('value', progress)
    file.previewElement.querySelector('.progress').innerHTML = `${progress}%`
  })

  page.dropzone.on('success', (file, response) => {
    if (!response) { return }
    file.previewTemplate.querySelector('.progress').style.display = 'none'

    if (response.success === false) {
      file.previewTemplate.querySelector('.error').innerHTML = response.description
    }

    if (response.files && response.files[0]) {
      page.updateTemplate(file, response.files[0])
    }
  })

  page.dropzone.on('error', (file, error) => {
    file.previewTemplate.querySelector('.progress').style.display = 'none'
    file.previewTemplate.querySelector('.error').innerHTML = error
  })

  page.prepareShareX()
}

page.updateTemplate = (file, response) => {
  if (!response.url) { return }

  const a = file.previewTemplate.querySelector('.link > a')
  const clipboard = file.previewTemplate.querySelector('.clipboard-mobile > .clipboard-js')
  a.href = a.innerHTML = clipboard.dataset['clipboardText'] = response.url
  clipboard.parentElement.style.display = 'block'

  const name = file.previewTemplate.querySelector('.name')
  name.innerHTML = file.name

  const exec = /.[\w]+(\?|$)/.exec(response.url)
  if (exec && exec[0] && imageExtensions.includes(exec[0].toLowerCase())) {
    const img = file.previewTemplate.querySelector('img')
    img.setAttribute('alt', response.name || '')
    img.dataset['src'] = response.url
    img.onerror = function () { this.style.display = 'none' } // hide webp in firefox and ie
    page.lazyLoad.update(file.previewTemplate.querySelectorAll('img'))
  }
}

page.prepareShareX = () => {
  if (page.token) {
    const sharexElement = document.getElementById('ShareX')
    const sharexFile =
      '{\r\n' +
      `  "Name": "${location.hostname}",\r\n` +
      '  "DestinationType": "ImageUploader, FileUploader",\r\n' +
      '  "RequestType": "POST",\r\n' +
      `  "RequestURL": "${location.origin}/api/upload",\r\n` +
      '  "FileFormName": "files[]",\r\n' +
      '  "Headers": {\r\n' +
      `    "token": "${page.token}"\r\n` +
      '  },\r\n' +
      '  "ResponseType": "Text",\r\n' +
      '  "URL": "$json:files[0].url$",\r\n' +
      '  "ThumbnailURL": "$json:files[0].url$"\r\n' +
      '}'
    const sharexBlob = new Blob([sharexFile], { type: 'application/octet-binary' })
    sharexElement.setAttribute('href', URL.createObjectURL(sharexBlob))
    sharexElement.setAttribute('download', `${location.hostname}.sxcu`)
  }
}

// Handle image paste event
window.addEventListener('paste', event => {
  const items = (event.clipboardData || event.originalEvent.clipboardData).items
  for (const index in items) {
    const item = items[index]
    if (item.kind === 'file') {
      const blob = item.getAsFile()
      console.log(blob.type)
      const file = new File([blob], `pasted-image.${blob.type.match(/(?:[^/]*\/)([^;]*)/)[1]}`)
      file.type = blob.type
      console.log(file)
      page.dropzone.addFile(file)
    }
  }
})

window.onload = () => {
  page.checkIfPublic()

  page.clipboardJS = new ClipboardJS('.clipboard-js')

  page.clipboardJS.on('success', () => {
    return swal('Copied!', 'The link has been copied to clipboard.', 'success')
  })

  page.clipboardJS.on('error', event => {
    console.error(event)
    return swal('An error occurred!', 'There was an error when trying to copy the link to clipboard, please check the console for more information.', 'error')
  })

  page.lazyLoad = new LazyLoad()
}
