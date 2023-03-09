const myNotification = new Notification('title',{
    body:"this is my render notification"
})

myNotification.onclick = () => {
    console.log("notification clicled");
}