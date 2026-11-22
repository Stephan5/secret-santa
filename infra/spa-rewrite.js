// A CloudFront Function on the site's requests (not the API's): any path
// whose last part isn't a file name (no dot) gets the single-page app's
// index.html, so /g/<id> works when opened from a link.
function handler(event) {
    var request = event.request
    var last = request.uri.split('/').pop()
    if (last.indexOf('.') === -1) request.uri = '/index.html'
    return request
}
